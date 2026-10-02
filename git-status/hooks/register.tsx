import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

type RenderEvent = RenderInput<'Pane' | 'AbovePrompt'>

import type { Check, Deployment, Item, LocalStatus, PullRequest, Remote, Snapshot } from '../types'
import {
  aggregate,
  checkFromRun,
  checkFromStatus,
  countFromLink,
  deploymentOf,
  latestPerEnvironment,
  parsePorcelain,
  parseGhResponse,
  parseRemote,
  intervalLabel,
  nextInterval,
  verdict,
} from './parse'

const PANE = 'git-status'
const LOCAL_EVERY_MS = 15_000
const GH_PATHS = ['gh', 'C:/Program Files/GitHub CLI/gh.exe', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const TICK_MS = 5_000

const expanded = atom({ plugin: 'git-status', key: 'isExpanded' } as const, false)
const interval = atom({ plugin: 'git-status', key: 'intervalMs' } as const, 60_000)

const snapshot = atom({ plugin: 'git-status', key: 'snapshot' } as const, {
  local: null,
  remote: null,
  updatedAt: 0,
  isRefreshing: false,
} as Snapshot)

const MARK: Record<Check['state'], string> = {
  passed: '✓',
  failed: '✗',
  running: '●',
  queued: '○',
  skipped: '–',
  neutral: '–',
}

const COLOR: Record<Check['state'], string | undefined> = {
  passed: 'green',
  failed: 'red',
  running: 'yellow',
  queued: 'yellow',
  skipped: undefined,
  neutral: undefined,
}

const DEPLOY_COLOR: Record<string, string | undefined> = {
  success: 'green',
  active: 'green',
  failure: 'red',
  error: 'red',
  in_progress: 'yellow',
  queued: 'yellow',
  pending: 'yellow',
}

const config = { repo: '', refreshMs: 60_000 }
const runtime = {
  gh: null as string | null,
  isRemoteBusy: false,
  pausedUntil: 0,
  rateRemaining: null as number | null,
  rateReset: 0,
  localAt: 0,
}

const LISTED = 5
const ENVIRONMENTS = 3



async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', ...args], { timeoutMs: 10_000 })

    return exitCode === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}

/** The working tree's status, or null outside a git repository. */
async function readLocal($: EngineInterface): Promise<LocalStatus | null> {
  const porcelain = await git($, ['status', '--porcelain=v2', '--branch'])
  if (porcelain === null) return null

  const status = parsePorcelain(porcelain)
  status.lastCommit = status.sha ? await git($, ['log', '-1', '--format=%s']) : null
  status.pushedSha = status.upstream ? await git($, ['rev-parse', '@{u}']) : null

  return status
}

/** `owner/name` of the repository to show: the configured one, else the upstream's or origin's GitHub remote. */
async function detectRepo($: EngineInterface, configured: string, upstream: string | null): Promise<string | null> {
  if (/^[\w.-]+\/[\w.-]+$/.test(configured.trim())) return configured.trim()

  const remotes = [upstream?.split('/')[0], 'origin'].filter((name): name is string => Boolean(name))
  for (const name of remotes) {
    const url = await git($, ['remote', 'get-url', name])
    const repo = url ? parseRemote(url) : null
    if (repo) return repo
  }

  return null
}

/** Finds a logged in gh, or says what is missing. */
async function resolveGh($: EngineInterface): Promise<{ gh: string } | { problem: string }> {
  let isInstalled = false

  // a session started before gh was installed does not have it on its PATH yet
  for (const gh of GH_PATHS) {
    try {
      const { exitCode } = await $.process.run([gh, 'auth', 'status'], { timeoutMs: 10_000 })
      if (exitCode === 0) return { gh }
      isInstalled = true
    } catch {
      // not installed there
    }
  }

  return {
    problem: isInstalled
      ? 'gh is not logged in: run gh auth login'
      : 'needs the GitHub CLI: winget install GitHub.cli, then gh auth login',
  }
}

class GitHubError extends Error {}

/** One GET on GitHub's REST API through gh, counting what is left of the rate limit. */
async function ghGet<T>($: EngineInterface, path: string): Promise<{ body: T; link?: string }> {
  const gh = runtime.gh ?? 'gh'
  const { stdout, stderr } = await $.process.run([gh, 'api', '--include', path], { timeoutMs: 20_000 })
  const response = parseGhResponse(stdout)
  if (!response) throw new GitHubError(stderr.trim() || 'gh api gave no answer')

  const remaining = response.headers['x-ratelimit-remaining']
  if (remaining !== undefined) runtime.rateRemaining = Number(remaining)
  if (response.headers['x-ratelimit-reset']) runtime.rateReset = Number(response.headers['x-ratelimit-reset']) * 1000

  if (response.status < 200 || response.status >= 300) {
    let message = ''
    try {
      message = (JSON.parse(response.body) as { message?: string }).message ?? ''
    } catch {
      // not JSON
    }
    throw new GitHubError(`GitHub ${response.status}${message ? `: ${message}` : ''}`)
  }

  return { body: JSON.parse(response.body) as T, link: response.headers.link }
}

type RawIssue = { number: number; title: string; user: { login: string } | null; pull_request?: unknown; draft?: boolean }
type RawPull = RawIssue & { html_url: string; head: { sha: string; ref: string }; base: { ref: string } }

const itemOf = (raw: RawIssue): Item => ({
  number: raw.number,
  title: raw.title,
  author: raw.user?.login ?? '?',
  isDraft: raw.draft || undefined,
})

/** Everything GitHub knows about the repository and the branch. */
async function readRemote(
  $: EngineInterface,
  repo: string,
  local: LocalStatus | null,
): Promise<Omit<Remote, 'rateRemaining' | 'error'>> {
  const [owner] = repo.split('/')
  const [info, pullCount, open] = await Promise.all([
    ghGet<{ open_issues_count: number }>($, `/repos/${repo}`),
    ghGet<RawPull[]>($, `/repos/${repo}/pulls?state=open&per_page=1`),
    ghGet<RawIssue[]>($, `/repos/${repo}/issues?state=open&per_page=30&sort=updated`),
  ])

  const openPulls = countFromLink(pullCount.link, pullCount.body.length)
  const issues = open.body.filter(one => !one.pull_request)
  const pulls = open.body.filter(one => one.pull_request)

  let pr: PullRequest | null = null
  if (local?.branch) {
    const own = await ghGet<RawPull[]>($, `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(local.branch)}`)
    const raw = own.body[0]
    if (raw) {
      pr = { ...itemOf(raw), url: raw.html_url, headSha: raw.head.sha, base: raw.base.ref }
    }
  }

  const sha = pr?.headSha ?? local?.pushedSha ?? null
  const [pipeline, deployments] = await Promise.all([
    sha ? readPipeline($, repo, sha) : Promise.resolve(null),
    readDeployments($, repo, sha),
  ])

  return {
    repo,
    openIssues: Math.max(0, info.body.open_issues_count - openPulls),
    openPulls,
    issues: issues.slice(0, LISTED).map(itemOf),
    pulls: pulls.slice(0, LISTED).map(itemOf),
    pr,
    pipeline,
    deployments,
  }
}

async function readPipeline($: EngineInterface, repo: string, sha: string) {
  const [runs, statuses] = await Promise.all([
    ghGet<{ check_runs: Parameters<typeof checkFromRun>[0][] }>($, `/repos/${repo}/commits/${sha}/check-runs?per_page=100`),
    ghGet<{ statuses: Parameters<typeof checkFromStatus>[0][] }>($, `/repos/${repo}/commits/${sha}/status?per_page=100`),
  ]).catch(error => {
    // a commit GitHub has not seen yet has no pipeline
    if (error instanceof GitHubError && /GitHub (404|422)/.test(error.message)) return [null, null] as const
    throw error
  })
  if (!runs || !statuses) return null

  const checks: Check[] = [...runs.body.check_runs.map(checkFromRun), ...statuses.body.statuses.map(checkFromStatus)]

  return aggregate(sha, checks)
}

async function readDeployments($: EngineInterface, repo: string, sha: string | null): Promise<Deployment[]> {
  const { body } = await ghGet<Parameters<typeof latestPerEnvironment>[0]>($, `/repos/${repo}/deployments?per_page=30`)
  const latest = latestPerEnvironment(body, sha).slice(0, ENVIRONMENTS)

  return Promise.all(
    latest.map(async raw => {
      const { body: statuses } = await ghGet<{ state: string; environment_url?: string; created_at: string }[]>(
        $, `/repos/${repo}/deployments/${raw.id}/statuses?per_page=1`,
      )
      const status = statuses[0]

      return deploymentOf(raw, status?.state ?? 'pending', status?.environment_url || null, status?.created_at ?? raw.created_at, sha)
    }),
  )
}

async function refreshLocal($: EngineInterface) {
  runtime.localAt = await $.clock.now()
  const local = await readLocal($)
  await update($, snapshot, old => ({ ...old, local }))
}

async function refreshRemote($: EngineInterface) {
  if (runtime.isRemoteBusy) return
  if ((await $.clock.now()) < runtime.pausedUntil) return
  runtime.isRemoteBusy = true
  await update($, snapshot, old => ({ ...old, isRefreshing: true }))

  try {
    const local = await readLocal($)
    const repo = await detectRepo($, config.repo, local?.upstream ?? null)
    let remote: Remote = emptyRemote(repo)
    if (!runtime.gh) {
      const found = await resolveGh($)
      if ('gh' in found) runtime.gh = found.gh
      else remote.error = found.problem
    }

    if (repo && runtime.gh) {
      try {
        remote = { ...remote, ...(await readRemote($, repo, local)) }
      } catch (error) {
        remote.error = error instanceof Error ? error.message : String(error)
      }
      remote.rateRemaining = runtime.rateRemaining
      if (runtime.rateRemaining === 0) runtime.pausedUntil = runtime.rateReset
    }

    const now = await $.clock.now()
    await update($, snapshot, () => ({ local, remote, updatedAt: now, isRefreshing: false }))
  } finally {
    runtime.isRemoteBusy = false
    await update($, snapshot, old => ({ ...old, isRefreshing: false }))
  }
}

/** Loads once at start, even with auto refresh off; a reload with data skips it. */
async function firstLoad($: EngineInterface) {
  const { updatedAt } = await read($, snapshot)
  if (updatedAt === 0) await refreshRemote($)
}

/** One auto refresh step: the working tree at most every 15 s, GitHub once the interval is up. */
async function tick($: EngineInterface) {
  const every = await read($, interval)
  if (every === 0) return

  const now = await $.clock.now()
  if (now - runtime.localAt >= Math.min(every, LOCAL_EVERY_MS) - 1000) await refreshLocal($)

  const { updatedAt } = await read($, snapshot)
  if (updatedAt === 0 || now - updatedAt >= every - 1000) await refreshRemote($)
}

/** The next auto refresh interval, kept for later sessions. */
async function cycleInterval($: EngineInterface) {
  const next = await update($, interval, nextInterval)
  await $.store.set('intervalMs', next)
}


/** One line: branch, changes, PR, CI, tests, deployments, open issues and PRs. */
function summary(local: LocalStatus, remote: Remote | null): string {
  const changes = local.staged + local.modified + local.untracked
  const parts = [
    `⎇ ${local.branch ?? 'detached'}${local.ahead ? ` ↑${local.ahead}` : ''}${local.behind ? ` ↓${local.behind}` : ''}${changes ? ` ✚${changes}` : ''}`,
  ]
  if (remote?.pr) parts.push(`PR #${remote.pr.number}`)
  const p = remote?.pipeline
  if (p && p.total > 0) {
    const word = verdict(p)
    const mark = word === 'failed' ? '✗' : word === 'running' ? '●' : '✓'
    parts.push(`CI ${mark} ${p.passed}/${p.total}${p.running ? ` (${p.running} running)` : ''}`)
    if (p.tests) parts.push(`Tests ${p.tests.passed}✓ ${p.tests.failed}✗`)
  }
  const deployment = remote?.deployments[0]
  if (deployment) parts.push(`${deployment.environment}: ${deployment.state}`)
  if (remote?.openIssues != null) parts.push(`${remote.openIssues} issues`)
  if (remote?.openPulls != null) parts.push(`${remote.openPulls} PRs`)
  if (remote?.error) parts.push(remote.error)
  else if (remote && !remote.repo) parts.push('no GitHub remote')

  return parts.join(' · ')
}

/** The whole picture: branch, PR, pipeline, deployments, open PRs and issues. */
async function drawDetails($: EngineInterface, e: RenderEvent, columns: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { local, remote, updatedAt, isRefreshing } = await read($, snapshot)
  const width = Math.max(20, columns)
  const ago = updatedAt ? Math.round(((await $.clock.now()) - updatedAt) / 1000) : null
  const cut = (text: string, room: number) => (text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text)

  const heading = (text: string) => (
    <Text bold color="cyan">
      {text}
    </Text>
  )
  const itemRow = (item: Item) => (
    <Text wrap="truncate-end">
      <Text dimColor>#{item.number}</Text> {cut(item.title, width - 8)}
      {item.isDraft ? <Text dimColor> (draft)</Text> : null}
    </Text>
  )

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>
          {isRefreshing ? 'refreshing… ' : ago !== null ? `updated ${ago}s ago ` : 'loading… '}
        </Text>
        <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refreshRemote($)} />
        <Button key="auto" label={`Auto ${intervalLabel(await read($, interval))}`} hotkey="a" onPress={() => cycleInterval($)} />
      </Box>

      {heading('Branch')}
      {!local && <Text dimColor>Not a git repository.</Text>}
      {local && (
        <Box flexDirection="column">
          <Text>
            ⎇ <Text bold>{local.branch ?? `detached at ${local.sha?.slice(0, 7) ?? '?'}`}</Text>
            {local.upstream ? <Text dimColor> → {local.upstream}</Text> : <Text dimColor> (no upstream)</Text>}
          </Text>
          <Text>
            {local.ahead ? <Text color="yellow">↑{local.ahead} </Text> : null}
            {local.behind ? <Text color="yellow">↓{local.behind} </Text> : null}
            <Text color={local.staged ? 'green' : undefined}>●{local.staged} staged </Text>
            <Text color={local.modified ? 'yellow' : undefined}>✚{local.modified} modified </Text>
            <Text dimColor>?{local.untracked} untracked</Text>
            {local.conflicted ? <Text color="red"> ✗{local.conflicted} conflicts</Text> : null}
          </Text>
          {local.lastCommit && (
            <Text dimColor wrap="truncate-end">
              {local.sha?.slice(0, 7)} {local.lastCommit}
            </Text>
          )}
        </Box>
      )}

      {remote && !remote.repo && <Text dimColor>No GitHub remote (set the repo option to choose one).</Text>}
      {remote?.error && <Text color="red">{remote.error}</Text>}

      {remote?.repo && (
        <Box flexDirection="column">
          {heading(`Pull request${local?.branch ? ` · ${local.branch}` : ''}`)}
          {remote.pr ? (
            <Box flexDirection="column">
              <Text wrap="truncate-end">
                <Text bold>#{remote.pr.number}</Text> {remote.pr.title}
                {remote.pr.isDraft ? <Text dimColor> (draft)</Text> : null}
              </Text>
              <Text dimColor wrap="truncate-end">
                → {remote.pr.base} · {remote.pr.url}
              </Text>
            </Box>
          ) : (
            <Text dimColor>No open PR for this branch.</Text>
          )}

          {heading(remote.pr ? 'Pipeline (PR head)' : 'Pipeline (last push)')}
          {!remote.pipeline && <Text dimColor>No pushed commit to check.</Text>}
          {remote.pipeline && remote.pipeline.total === 0 && <Text dimColor>No checks on {remote.pipeline.sha.slice(0, 7)}.</Text>}
          {remote.pipeline && remote.pipeline.total > 0 && (
            <Box flexDirection="column">
              <Text>
                <Text color="green">✓{remote.pipeline.passed} </Text>
                <Text color={remote.pipeline.failed ? 'red' : undefined}>✗{remote.pipeline.failed} </Text>
                <Text color={remote.pipeline.running ? 'yellow' : undefined}>●{remote.pipeline.running} running </Text>
                <Text dimColor>
                  ○{remote.pipeline.queued} queued · {remote.pipeline.total} checks
                </Text>
              </Text>
              <Text>
                Tests:{' '}
                {remote.pipeline.tests ? (
                  <Text>
                    <Text color="green">{remote.pipeline.tests.passed} passed</Text>
                    {', '}
                    <Text color={remote.pipeline.tests.failed ? 'red' : undefined}>{remote.pipeline.tests.failed} failed</Text>
                    <Text dimColor>, {remote.pipeline.tests.skipped} skipped</Text>
                  </Text>
                ) : (
                  <Text dimColor>n/a (no check reports counts)</Text>
                )}
              </Text>
              {remote.pipeline.checks.slice(0, 12).map(check => (
                <Text wrap="truncate-end">
                  <Text color={COLOR[check.state]}>{MARK[check.state]}</Text> {check.name}
                  {check.summary ? <Text dimColor> · {check.summary}</Text> : null}
                </Text>
              ))}
            </Box>
          )}

          {heading('Deployments')}
          {remote.deployments.length === 0 && <Text dimColor>None.</Text>}
          {remote.deployments.map(one => (
            <Text wrap="truncate-end">
              <Text color={DEPLOY_COLOR[one.state]}>{one.state}</Text> {one.environment}
              <Text dimColor>
                {' '}
                · {one.isThisCommit ? 'this commit' : one.ref} · {one.at.slice(0, 16).replace('T', ' ')}
              </Text>
            </Text>
          ))}

          {heading(`Open pull requests (${remote.openPulls ?? '?'})`)}
          {remote.pulls.length === 0 && <Text dimColor>None.</Text>}
          {remote.pulls.map(itemRow)}

          {heading(`Open issues (${remote.openIssues ?? '?'})`)}
          {remote.issues.length === 0 && <Text dimColor>None.</Text>}
          {remote.issues.map(itemRow)}

          <Text dimColor>
            {remote.repo}
            {remote.rateRemaining !== null ? ` · ${remote.rateRemaining} API calls left` : ''}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export const register: Register = (on, options) => {
  config.repo = String(options.repo ?? '')
  config.refreshMs = Math.max(15, Number(options.refreshSeconds ?? 60)) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-status',
      description: 'Show git status, issues, pull requests, CI and deployments (refreshes them)',
    })

    const stored = await $.store.get('intervalMs')
    const every = typeof stored === 'number' ? stored : config.refreshMs
    await update($, interval, () => every)

    // a reload keeps the snapshot, so only a stale one is fetched again
    $.clock.after(0, () => void firstLoad($))
    $.clock.every(TICK_MS, () => void tick($))
    void $.ui.open({ id: PANE, title: 'Git' })

    return next(e)
  })

  on('command.run', { command: 'git-status' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Git', focus: true, rows: 24 })
    void refreshRemote($)
    if (!opened.isPlaced) return { text: `Git status pane waits: ${opened.reason}` }

    return { text: 'Git status pane opened. Details also sit above the prompt: press [ Git ].' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!/^(Bash|PowerShell)$/.test(String(e.tool))) return result
    const command = String((e as { command?: unknown }).command ?? '')
    if (/\bgit\s+push\b|\bgh\s+pr\b/.test(command)) void refreshRemote($)
    else if (/\bgit\b/.test(command)) void refreshLocal($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    void refreshLocal($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return drawDetails($, e, e.props.bodyColumns)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const { local, remote } = await read($, snapshot)
    if (e.props.hasSurvey || !local) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const isExpanded = await read($, expanded)
    const columns = e.props.bodyColumns

    return (
      <Box flexDirection="column">
        <Box>
          <Text wrap="truncate-end">{summary(local, remote)} </Text>
          <Button key="git-details" label={isExpanded ? 'Less' : 'Git'} onPress={() => update($, expanded, is => !is)} />
        </Box>
        {isExpanded ? await drawDetails($, e, columns) : null}
        {below}
      </Box>
    )
  })
}

function emptyRemote(repo: string | null): Remote {
  return {
    repo,
    openIssues: null,
    openPulls: null,
    issues: [],
    pulls: [],
    pr: null,
    pipeline: null,
    deployments: [],
    rateRemaining: null,
    error: null,
  }
}
