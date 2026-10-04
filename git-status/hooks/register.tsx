import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

type RenderEvent = RenderInput<'Pane' | 'AbovePrompt'>

import type { Check, Deployment, Item, LocalStatus, PullDetails, PullRequest, Release, Remote, Snapshot } from '../types'
import {
  aggregate,
  checkFromRun,
  checkFromStatus,
  countFromLink,
  deploymentOf,
  latestPerEnvironment,
  parsePorcelain,
  checkTime,
  ciChange,
  mergeSummary,
  parseGhResponse,
  pullDetailsOf,
  reviewSummary,
  safeUrl,
  parseRemote,
  intervalLabel,
  nextInterval,
} from './parse'
import type { Said } from './parse'
import {
  LOOK,
  blockers,
  checklist,
  fitBlockers,
  fitSegments,
  groupChecks,
  overallState,
  reviewTally,
  reviewersOf,
  widthOf,
} from './overview'
import type { Reviewer, Segment, Step, View } from './overview'

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

type RawIssue = {
  number: number
  title: string
  user: { login: string } | null
  pull_request?: unknown
  draft?: boolean
  html_url?: string
}
type RawPull = RawIssue & { html_url: string; head: { sha: string; ref: string }; base: { ref: string } }

const itemOf = (raw: RawIssue): Item => ({
  number: raw.number,
  title: raw.title,
  author: raw.user?.login ?? '?',
  isDraft: raw.draft || undefined,
  isPull: raw.pull_request ? true : undefined,
  url: safeUrl(raw.html_url) ?? undefined,
})

const PULL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision mergeable mergeStateStatus additions deletions changedFiles
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } } } }
      latestReviews(first: 20) { nodes { author { login } state comments { totalCount } } }
      reviewThreads(first: 100) { nodes { isResolved } }
    }
  }
}`

/** One GraphQL query through gh. */
async function ghGraphql<T>($: EngineInterface, query: string, variables: Record<string, string | number>): Promise<T> {
  const fields = Object.entries(variables).flatMap(([name, value]) => ['-F', `${name}=${value}`])
  const { stdout, stderr } = await $.process.run([runtime.gh ?? 'gh', 'api', 'graphql', '-f', `query=${query}`, ...fields], {
    timeoutMs: 20_000,
  })
  let answer: { data?: T; errors?: { message: string }[] }
  try {
    answer = JSON.parse(stdout) as typeof answer
  } catch {
    throw new GitHubError(stderr.trim() || 'gh api graphql gave no answer')
  }
  if (!answer.data) throw new GitHubError(answer.errors?.[0]?.message ?? 'GraphQL gave no data')

  return answer.data
}

async function readPullDetails($: EngineInterface, repo: string, number: number): Promise<PullDetails | null> {
  const [owner, name] = repo.split('/')
  try {
    const data = await ghGraphql<{ repository: { pullRequest: Parameters<typeof pullDetailsOf>[0] | null } }>($, PULL_QUERY, {
      owner: owner ?? '',
      name: name ?? '',
      number,
    })

    return data.repository.pullRequest ? pullDetailsOf(data.repository.pullRequest) : null
  } catch {
    return null
  }
}

/** The first open issues and PRs a search finds for the person gh is logged in as, and how many it found in all. */
async function searchMine($: EngineInterface, repo: string, terms: string): Promise<{ items: Item[]; total: number | null }> {
  const q = encodeURIComponent(`repo:${repo} is:open ${terms}`)
  try {
    const { body } = await ghGet<{ total_count?: number; items: RawIssue[] }>($, `/search/issues?q=${q}&per_page=${LISTED}&sort=updated`)
    const items = body.items.map(itemOf)

    return { items, total: body.total_count ?? items.length }
  } catch {
    return { items: [], total: null }
  }
}

/** The newest published release, or null when there is none. */
async function readLatestRelease($: EngineInterface, repo: string): Promise<Release | null> {
  try {
    const { body } = await ghGet<{ tag_name: string; published_at: string | null; html_url: string }>($, `/repos/${repo}/releases/latest`)
    if (!body.tag_name) return null

    return { tag: body.tag_name, isRelease: true, publishedAt: body.published_at, url: body.html_url, commitsSince: null }
  } catch {
    return null
  }
}

/** The newest tag, or null when there is none. */
async function readNewestTag($: EngineInterface, repo: string): Promise<Release | null> {
  try {
    const { body } = await ghGet<{ name: string }[]>($, `/repos/${repo}/tags?per_page=1`)
    const tag = body[0]
    if (!tag) return null

    return { tag: tag.name, isRelease: false, publishedAt: null, url: `https://github.com/${repo}/tree/${encodeURIComponent(tag.name)}`, commitsSince: null }
  } catch {
    return null
  }
}

/** The newest release, else the newest tag, and how many commits `sha` is past it. */
async function readRelease($: EngineInterface, repo: string, sha: string | null): Promise<Release | null> {
  const release = (await readLatestRelease($, repo)) ?? (await readNewestTag($, repo))
  if (release && sha) {
    try {
      const { body } = await ghGet<{ ahead_by: number }>($, `/repos/${repo}/compare/${encodeURIComponent(release.tag)}...${sha}`)
      release.commitsSince = body.ahead_by
    } catch {
      // a commit GitHub has not seen yet
    }
  }

  return release
}

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
      pr = { ...itemOf(raw), url: raw.html_url, headSha: raw.head.sha, base: raw.base.ref, details: null }
    }
  }

  const sha = pr?.headSha ?? null
  const [pipeline, deployments, details, assigned, reviewRequests, release] = await Promise.all([
    sha ? readPipeline($, repo, sha) : Promise.resolve(null),
    readDeployments($, repo, sha),
    pr ? readPullDetails($, repo, pr.number) : Promise.resolve(null),
    searchMine($, repo, 'assignee:@me'),
    searchMine($, repo, 'is:pr review-requested:@me'),
    readRelease($, repo, sha ?? local?.pushedSha ?? null),
  ])
  if (pr) pr.details = details

  return {
    repo,
    openIssues: Math.max(0, info.body.open_issues_count - openPulls),
    openPulls,
    issues: issues.slice(0, LISTED).map(itemOf),
    pulls: pulls.slice(0, LISTED).map(itemOf),
    pr,
    assigned: assigned.items,
    reviewRequests: reviewRequests.items,
    assignedCount: assigned.total,
    reviewRequestCount: reviewRequests.total,
    release,
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

    const before = (await read($, snapshot)).remote
    const toast = ciChange(before?.pipeline ?? null, remote.pipeline, remote.pr ? `PR #${remote.pr.number}` : (local?.branch ?? ''))
    if (toast) $.ui.toast(toast, { timeoutMs: 8000 })

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


/** How many are assigned to and await a review from you; a snapshot from before the counts has its lists alone. */
const assignedCount = (remote: Remote) => remote.assignedCount ?? remote.assigned.length
const reviewRequestCount = (remote: Remote) => remote.reviewRequestCount ?? remote.reviewRequests.length

const viewOf = (local: LocalStatus, remote: Remote | null): View => ({
  local,
  pr: remote?.pr ?? null,
  pipeline: remote?.pr ? remote.pipeline : null,
  deployments: remote?.deployments ?? [],
})

/** Room the toggle takes at the end of the first line: `[ Less ]` and its gap. */
const TOGGLE = 9
const REVIEWS_LISTED = 5
const ASSIGNED_LISTED = 3
const GROUPS_LISTED = 8

/** Segments in a row, a dim dot between them; each segment one Text, so a test finds it whole. */
function drawSegments($: EngineInterface, e: RenderInput<'AbovePrompt'>, segments: Said[][], gap: string) {
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexShrink={1}>
      {segments.map((parts, index) => (
        <Box flexShrink={index === 0 ? 1 : 0}>
          {index > 0 ? <Text dimColor>{gap}</Text> : null}
          <Text wrap="truncate-end">
            {parts.map(part => (
              <Text color={part.color}>{part.text}</Text>
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const counted = (n: number | null, what: string, mine: number, label: string): Said[] => [
  { text: `${n ?? '?'} ${what}` },
  ...(mine > 0 ? [{ text: ` (${mine} ${label})`, color: 'cyan' }] : []),
]

/** Branch, working tree, PR and what the repository holds for you, as segments to fit a line. */
function overviewSegments(local: LocalStatus, remote: Remote | null, isCalm: boolean): Segment[] {
  const pr = remote?.pr ?? null
  const pipeline = pr ? (remote?.pipeline ?? null) : null
  const segments: Segment[] = [
    {
      priority: 0,
      parts: [
        { text: `⎇ ${local.branch ?? `detached ${local.sha?.slice(0, 7) ?? ''}`}` },
        { text: local.upstream ? ` → ${local.upstream}` : ' (not pushed)', color: 'gray' },
        ...(local.ahead ? [{ text: ` ↑${local.ahead}`, color: 'yellow' }] : []),
        ...(local.behind ? [{ text: ` ↓${local.behind}`, color: 'yellow' }] : []),
      ],
      short: [{ text: `⎇ ${local.branch ?? local.sha?.slice(0, 7) ?? ''}` }],
    },
  ]
  const isTouched = local.staged + local.modified + local.untracked + local.conflicted > 0
  if (!isCalm || local.untracked) {
    segments.push({
      priority: 2,
      parts: isTouched
        ? [
            { text: `●${local.staged}`, color: local.staged ? 'green' : 'gray' },
            { text: ` ✚${local.modified}`, color: local.modified ? 'yellow' : 'gray' },
            { text: ` ?${local.untracked}`, color: 'gray' },
          ]
        : [{ text: 'clean', color: 'gray' }],
    })
  }
  if (pr) {
    segments.push({
      priority: 1,
      parts: [{ text: `#${pr.number} ${pr.title}` }, { text: ` → ${pr.base}`, color: 'gray' }],
      short: [{ text: `#${pr.number}` }],
    })
  }
  if (isCalm && pipeline && pipeline.total > 0) {
    segments.push({ priority: 0, parts: [{ text: `CI ✓ ${pipeline.passed}/${pipeline.total}`, color: 'green' }], short: [{ text: '✓', color: 'green' }] })
  }
  if (isCalm && pr?.details?.reviewDecision === 'APPROVED') {
    segments.push({ priority: 2, parts: [{ text: '✓ approved', color: 'green' }] })
  }
  if (remote?.repo && !remote.error) {
    segments.push({ priority: 3, parts: counted(remote.openIssues, 'issues', assignedCount(remote), 'assigned') })
    segments.push({ priority: 3, parts: counted(remote.openPulls, 'PRs', reviewRequestCount(remote), 'to review') })
    if (remote.release) {
      segments.push({
        priority: 4,
        parts: [{ text: remote.release.tag }, ...(remote.release.commitsSince ? [{ text: ` +${remote.release.commitsSince}`, color: 'gray' }] : [])],
      })
    }
  }
  if (local.lastCommit) segments.push({ priority: 5, parts: [{ text: `${local.sha?.slice(0, 7)} ${local.lastCommit}`, color: 'gray' }] })

  return segments
}

/**
 * The band above the prompt: a badge with the verdict, then, when calm, one line of what matters most;
 * otherwise the blockers, and a second line with branch, working tree and the repository's counts.
 */
function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, local: LocalStatus, remote: Remote | null, isExpanded: boolean, width: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const state = overallState(viewOf(local, remote))
  const look = LOOK[state]
  const badge = ` ${look.mark} ${state} `
  const room = Math.max(0, width - TOGGLE - widthOf(badge) - 1)
  const toggle = <Button key="git-details" label={isExpanded ? 'Less' : 'Git'} onPress={() => update($, expanded, is => !is)} />

  let first
  if (look.isCalm) {
    const fitted = fitSegments(overviewSegments(local, remote, true), room, 3)
    first = (
      <Box flexShrink={1}>
        {drawSegments($, e, fitted.segments, ' · ')}
        {fitted.hidden ? <Text color="yellow"> +{fitted.hidden}</Text> : null}
      </Box>
    )
  } else {
    const view = viewOf(local, remote)
    const fitted = fitBlockers(blockers(view, false), blockers(view, true), room)
    first = (
      <Box flexShrink={1}>
        {drawSegments($, e, fitted.shown.map(said => [said]), '  ')}
        {fitted.hidden ? <Text dimColor>{fitted.shown.length ? '  ' : ''}+{fitted.hidden}</Text> : null}
      </Box>
    )
  }

  const problem = remote && (remote.error || !remote.repo) ? (remote.error ?? 'No GitHub remote (set the repo option to choose one).') : null

  return (
    <Box flexDirection="column">
      <Box>
        <Box flexShrink={0} paddingRight={1}>
          <Text bold color="black" backgroundColor={look.color}>
            {badge}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {first}
        </Box>
        <Box flexShrink={0} paddingLeft={1}>
          {toggle}
        </Box>
      </Box>
      {look.isCalm ? null : drawSegments($, e, fitSegments(overviewSegments(local, remote, false), width, 3).segments, ' · ')}
      {problem && (
        <Text color={remote?.error ? 'red' : undefined} dimColor={!remote?.error} wrap="wrap">
          {problem}
        </Text>
      )}
    </Box>
  )
}

const STEP_LOOK: Record<Step['state'], { mark: string; color: string }> = {
  done: { mark: '✓', color: 'green' },
  failed: { mark: '✗', color: 'red' },
  warning: { mark: '!', color: 'yellow' },
  waiting: { mark: '○', color: 'yellow' },
  todo: { mark: '·', color: 'gray' },
}

const REVIEWER_LOOK: Record<Reviewer['state'], { mark: string; color: string | undefined }> = {
  approved: { mark: '✓', color: 'green' },
  changes: { mark: '✗', color: 'red' },
  commented: { mark: '●', color: undefined },
  pending: { mark: '○', color: 'yellow' },
}

/** The band opened: the merge checklist, the reviewers, the checks not done, what waits for you, and the controls. */
async function drawExpanded($: EngineInterface, e: RenderInput<'AbovePrompt'>, local: LocalStatus, remote: Remote | null, width: number) {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const { updatedAt, isRefreshing } = await read($, snapshot)
  const now = await $.clock.now()
  const ago = updatedAt ? Math.round((now - updatedAt) / 1000) : null
  const view = viewOf(local, remote)
  const list = checklist(view)
  const pr = view.pr
  const reviewers = pr?.details ? reviewersOf(pr.details) : []
  const open = view.pipeline ? groupChecks(view.pipeline.checks.filter(check => /^(failed|running|queued)$/.test(check.state))) : []
  const nameWidth = Math.min(28, Math.max(12, Math.floor(width / 4)))

  const heading = (text: string, extra?: string) => (
    <Box>
      <Text bold color="cyan">
        {text}
      </Text>
      {extra ? <Text dimColor> {extra}</Text> : null}
    </Box>
  )
  const mark = (text: string, color?: string) => (
    <Box width={2} flexShrink={0}>
      <Text color={color}>{text}</Text>
    </Box>
  )
  const more = (n: number) => (n > 0 ? <Text dimColor>… {n} more</Text> : null)
  const itemRow = (item: Item) => (
    <Box>
      <Box width={7} flexShrink={0}>
        {item.url ? (
          <Link href={item.url}>
            <Text color="blue">#{item.number}</Text>
          </Link>
        ) : (
          <Text dimColor>#{item.number}</Text>
        )}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{item.title}</Text>
      </Box>
      <Box flexShrink={0} paddingLeft={1}>
        <Text dimColor>{item.author}</Text>
      </Box>
    </Box>
  )

  const tally = reviewTally(reviewers)
  const tallyText = [
    tally.approved && `${tally.approved} approved`,
    tally.changes && `${tally.changes} changes`,
    tally.commented && `${tally.commented} commented`,
    tally.pending && `${tally.pending} pending`,
  ]
    .filter(Boolean)
    .join(' · ')

  const reviews = remote?.reviewRequests ?? []
  const assigned = remote?.assigned ?? []
  const reviewTotal = remote ? reviewRequestCount(remote) : 0
  const assignedTotal = remote ? assignedCount(remote) : 0

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(Math.max(0, width))}</Text>

      {heading(list.title)}
      {list.items.map(item => (
        <Box>
          {mark(STEP_LOOK[item.state].mark, STEP_LOOK[item.state].color)}
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={item.state === 'done' ? undefined : STEP_LOOK[item.state].color}>{item.text}</Text>
              {item.detail ? <Text dimColor> {item.detail}</Text> : null}
            </Text>
          </Box>
          {item.hint ? (
            <Box flexShrink={0} paddingLeft={1}>
              <Text dimColor>{item.hint}</Text>
            </Box>
          ) : null}
        </Box>
      ))}

      {reviewers.length > 0 && heading('Reviewers', tallyText)}
      {reviewers.map(reviewer => (
        <Box>
          {mark(REVIEWER_LOOK[reviewer.state].mark, REVIEWER_LOOK[reviewer.state].color)}
          <Box width={nameWidth} flexShrink={0}>
            <Text wrap="truncate-end">{reviewer.name}</Text>
          </Box>
          <Box width={11} flexShrink={0}>
            <Text color={REVIEWER_LOOK[reviewer.state].color} dimColor={reviewer.state === 'commented'}>
              {reviewer.state}
            </Text>
          </Box>
          {reviewer.comments > 0 ? <Text dimColor>{reviewer.comments === 1 ? '1 comment' : `${reviewer.comments} comments`}</Text> : null}
        </Box>
      ))}

      {open.length > 0 && view.pipeline && heading('Open checks', `${view.pipeline.total - view.pipeline.passed - view.pipeline.skipped} of ${view.pipeline.total}`)}
      {open.slice(0, GROUPS_LISTED).map(group => {
        const failedIn = group.checks.filter(check => check.state === 'failed')
        const url = (failedIn[0] ?? group.checks[0])?.url

        return (
          <Box>
            {mark(MARK[group.state], COLOR[group.state])}
            <Box width={nameWidth} flexShrink={0}>
              <Text wrap="truncate-end">{group.checks.length > 1 ? `${group.name} ×${group.checks.length}` : group.name}</Text>
            </Box>
            <Box width={9} flexShrink={0}>
              <Text color={COLOR[group.state]}>{group.state}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {group.failedTests ? `${group.failedTests} tests failed` : group.variants.length > 1 ? group.variants.join(', ') : ''}
              </Text>
            </Box>
            {url ? (
              <Box flexShrink={0} paddingLeft={1}>
                <Link href={url}>
                  <Text color="blue">log ↗</Text>
                </Link>
              </Box>
            ) : null}
          </Box>
        )
      })}
      {more(open.length - GROUPS_LISTED)}

      {remote?.repo && heading('Waiting for you')}
      {remote?.repo && reviewTotal === 0 && assignedTotal === 0 && <Text dimColor>Nothing to review or assigned to you.</Text>}
      {reviewTotal > 0 && <Text dimColor>Reviews ({reviewTotal})</Text>}
      {reviews.slice(0, REVIEWS_LISTED).map(itemRow)}
      {reviewTotal > 0 && more(reviewTotal - Math.min(reviews.length, REVIEWS_LISTED))}
      {assignedTotal > 0 && <Text dimColor>Assigned ({assignedTotal})</Text>}
      {assigned.slice(0, ASSIGNED_LISTED).map(itemRow)}
      {assignedTotal > 0 && more(assignedTotal - Math.min(assigned.length, ASSIGNED_LISTED))}

      <Box flexWrap="wrap">
        <Text dimColor>
          {remote?.repo ? `${remote.repo} · ` : ''}
          {remote?.release ? `${remote.release.tag}${remote.release.commitsSince ? ` +${remote.release.commitsSince}` : ''} · ` : ''}
          {isRefreshing ? 'refreshing… ' : ago !== null ? `updated ${ago}s ago ` : 'loading… '}
        </Text>
        <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refreshRemote($)} />
        <Button key="auto" label={`Auto ${intervalLabel(await read($, interval))}`} hotkey="a" onPress={() => cycleInterval($)} />
        {remote?.rateRemaining != null ? <Text dimColor> {remote.rateRemaining} API calls left</Text> : null}
      </Box>
    </Box>
  )
}

type Column = { title: string; width?: number }
type Cell = { text: string; color?: string; isDim?: boolean; href?: string }

async function drawDetails($: EngineInterface, e: RenderEvent, columns: number) {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const { local, remote, updatedAt, isRefreshing } = await read($, snapshot)
  const width = Math.max(20, columns)
  const now = await $.clock.now()
  const ago = updatedAt ? Math.round((now - updatedAt) / 1000) : null

  /** Opens in the browser: blue, underlined and an arrow, which shows even where the terminal cannot underline. */
  const link = (href: string, text: string) => (
    <Link href={href}>
      <Text color="blue" underline>
        {text} ↗
      </Text>
    </Link>
  )
  const heading = (text: string) => (
    <Text bold color="cyan">
      {text}
    </Text>
  )
  /** Rows under a dim header, each column `width` cells wide; a column without one takes the rest. */
  const table = (columns: Column[], rows: Cell[][], empty: string) => (
    <Box flexDirection="column">
      <Box>
        {columns.map(column => (
          <Box width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} paddingRight={1}>
            <Text bold dimColor wrap="truncate-end">
              {column.title}
            </Text>
          </Box>
        ))}
      </Box>
      {rows.length === 0 && <Text dimColor>{empty}</Text>}
      {rows.map(row => (
        <Box>
          {columns.map((column, index) => {
            const cell = row[index] ?? { text: '' }

            return (
              <Box width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} paddingRight={1}>
                {cell.href ? (
                  link(cell.href, cell.text)
                ) : (
                  <Text color={cell.color} dimColor={cell.isDim} wrap="truncate-end">
                    {cell.text}
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
  const itemTable = (items: Item[], empty: string) =>
    table(
      [{ title: '#', width: 9 }, { title: 'Title' }, { title: 'Author', width: Math.min(18, Math.max(8, Math.floor(width / 5))) }],
      items.map(item => [
        item.url ? { text: `#${item.number}`, href: item.url } : { text: `#${item.number}`, isDim: true },
        { text: `${item.isPull ? 'PR ' : ''}${item.title}${item.isDraft ? ' (draft)' : ''}` },
        { text: item.author, isDim: true },
      ]),
      empty,
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
                → {remote.pr.base} · {link(remote.pr.url, remote.pr.url)}
              </Text>
              {remote.pr.details && (
                <Box flexDirection="column">
                  <Text wrap="truncate-end">
                    <Text dimColor>Review </Text>
                    <Text color={reviewSummary(remote.pr.details).color}>{reviewSummary(remote.pr.details).text}</Text>
                  </Text>
                  <Text wrap="truncate-end">
                    <Text dimColor>Merge  </Text>
                    <Text color={mergeSummary(remote.pr.details, remote.pr.base).color}>
                      {mergeSummary(remote.pr.details, remote.pr.base).text}
                    </Text>
                  </Text>
                  <Text wrap="truncate-end">
                    <Text dimColor>Diff   </Text>
                    <Text color="green">+{remote.pr.details.additions}</Text> <Text color="red">−{remote.pr.details.deletions}</Text>
                    <Text dimColor> · {remote.pr.details.changedFiles} files · </Text>
                    <Text color={remote.pr.details.unresolvedThreads ? 'yellow' : undefined} dimColor={!remote.pr.details.unresolvedThreads}>
                      {remote.pr.details.unresolvedThreads} unresolved threads
                    </Text>
                  </Text>
                </Box>
              )}
            </Box>
          ) : (
            <Text dimColor>No open PR for this branch.</Text>
          )}

          {remote.pr && heading('Pipeline')}
          {remote.pr && remote.pipeline && (
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
              {table(
                [
                  { title: '', width: 2 },
                  { title: 'Check', width: Math.min(28, Math.floor(width * 0.3)) },
                  { title: 'Status', width: 9 },
                  { title: 'Time', width: 12 },
                  { title: 'Tests', width: 12 },
                  { title: 'Summary' },
                  { title: 'Log', width: 7 },
                ],
                remote.pipeline.checks.slice(0, 12).map(check => [
                  { text: MARK[check.state], color: COLOR[check.state] },
                  { text: check.name },
                  { text: check.state, color: COLOR[check.state] },
                  { text: checkTime(check, now), isDim: check.state !== 'running' },
                  check.tests
                    ? { text: `${check.tests.passed}✓ ${check.tests.failed}✗`, color: check.tests.failed ? 'red' : 'green' }
                    : { text: '–', isDim: true },
                  { text: check.summary ?? '', isDim: true },
                  check.url ? { text: 'log', href: check.url } : { text: '' },
                ]),
                `No checks on ${remote.pipeline.sha.slice(0, 7)}.`,
              )}
            </Box>
          )}

          {heading(`Deployments (${remote.deployments.length})`)}
          {remote.deployments.length > 0 && table(
              [{ title: 'Environment', width: 16 }, { title: 'Status', width: 12 }, { title: 'Ref' }, { title: 'When', width: 17 }],
              remote.deployments.map(one => [
                { text: one.environment },
                { text: one.state, color: DEPLOY_COLOR[one.state] },
                { text: one.isThisCommit ? 'this commit' : one.ref, isDim: !one.isThisCommit },
                { text: one.at.slice(0, 16).replace('T', ' '), isDim: true },
              ]),
              'No deployments.',
            )}

          {heading(`Open pull requests (${remote.openPulls ?? '?'})`)}
          {remote.pulls.length > 0 && itemTable(remote.pulls, 'No open pull requests.')}

          {heading(`Open issues (${remote.openIssues ?? '?'})`)}
          {remote.issues.length > 0 && itemTable(remote.issues, 'No open issues.')}

          {heading(`Assigned to you (${assignedCount(remote)})`)}
          {remote.assigned.length > 0 && itemTable(remote.assigned, 'Nothing assigned to you.')}

          {heading(`Review requested from you (${reviewRequestCount(remote)})`)}
          {remote.reviewRequests.length > 0 && itemTable(remote.reviewRequests, 'No reviews requested from you.')}

          {heading(remote.release ? 'Latest release' : 'Latest release (none)')}
          {remote.release && (
            <Text wrap="truncate-end">
              {link(remote.release.url, remote.release.tag)}
              <Text dimColor>
                {remote.release.isRelease ? '' : ' (tag)'}
                {remote.release.publishedAt ? ` · ${remote.release.publishedAt.slice(0, 10)}` : ''}
              </Text>
              {remote.release.commitsSince !== null && (
                <Text color={remote.release.commitsSince ? 'yellow' : 'green'}>
                  {' '}
                  · {remote.release.commitsSince === 0 ? 'nothing new since' : `${remote.release.commitsSince} commits since`}
                </Text>
              )}
            </Text>
          )}

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
    // earlier versions kept an entry in the status line
    $.ui.status(undefined)
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

    const { Box } = $.ui.resolve(e)
    const isExpanded = await read($, expanded)
    const inner = e.props.bodyColumns - 4
    // the frame takes the badge's color
    const frame = LOOK[overallState(viewOf(local, remote))].color

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={frame} paddingX={1}>
          {drawBand($, e, local, remote, isExpanded, inner)}
          {isExpanded ? await drawExpanded($, e, local, remote, inner) : null}
        </Box>
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
    assigned: [],
    reviewRequests: [],
    assignedCount: null,
    reviewRequestCount: null,
    release: null,
    pipeline: null,
    deployments: [],
    rateRemaining: null,
    error: null,
  }
}
