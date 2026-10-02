import type { Check, Deployment, LocalStatus, Pipeline, TestCounts } from '../types'

/** `owner/name` of a GitHub remote URL in any of its spellings, or null. */
export function parseRemote(url: string): string | null {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())

  return match ? `${match[1]}/${match[2]}` : null
}

/** What `git status --porcelain=v2 --branch` says about the working tree. */
export function parsePorcelain(text: string): LocalStatus {
  const status: LocalStatus = {
    branch: null,
    sha: null,
    upstream: null,
    pushedSha: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    lastCommit: null,
  }

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('# branch.oid ')) {
      const sha = line.slice(13)
      status.sha = sha === '(initial)' ? null : sha
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14)
      status.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice(18)
    } else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ')
      status.ahead = Math.abs(Number(ahead)) || 0
      status.behind = Math.abs(Number(behind)) || 0
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') status.staged += 1
      if (line[3] !== '.') status.modified += 1
    } else if (line.startsWith('u ')) {
      status.conflicted += 1
    } else if (line.startsWith('? ')) {
      status.untracked += 1
    }
  }

  return status
}

/** The item count of a paginated list fetched with `per_page=1`. */
export function countFromLink(link: string | undefined, onPage: number): number {
  const last = link ? /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link) : null

  return last ? Number(last[1]) : onPage
}

/** Test counts a check run's title or summary states, or null when it states none. */
export function parseTestCounts(text: string | null | undefined): TestCounts | null {
  if (!text) return null

  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 }
  let isFound = false
  const pattern = /(\d[\d,]*)\s+(?:tests?\s+)?(passed|passing|succeeded|failed|failing|failures?|errors?|skipped|pending|ignored)\b/gi

  for (const [, number, word] of text.matchAll(pattern)) {
    const n = Number((number ?? '0').replace(/,/g, ''))
    const kind = (word ?? '').toLowerCase()
    isFound = true
    if (/^(passed|passing|succeeded)$/.test(kind)) counts.passed += n
    else if (/^(skipped|pending|ignored)$/.test(kind)) counts.skipped += n
    else counts.failed += n
  }

  return isFound ? counts : null
}

type CheckRun = {
  name: string
  status: string
  conclusion: string | null
  output?: { title?: string | null; summary?: string | null }
}

type CommitStatus = { context: string; state: string; description: string | null }

export function checkFromRun(run: CheckRun): Check {
  const summary = run.output?.title || null
  const tests = parseTestCounts(run.output?.title) ?? parseTestCounts(run.output?.summary)

  return { name: run.name, state: stateOfRun(run), summary, tests }
}

function stateOfRun(run: CheckRun): Check['state'] {
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'requested' || run.status === 'pending') {
    return 'queued'
  }
  if (run.status !== 'completed') return 'running'

  switch (run.conclusion) {
    case 'success':
      return 'passed'
    case 'skipped':
      return 'skipped'
    case 'neutral':
    case 'stale':
      return 'neutral'
    default:
      return 'failed'
  }
}

export function checkFromStatus(status: CommitStatus): Check {
  const state: Check['state'] = status.state === 'success' ? 'passed' : status.state === 'pending' ? 'running' : 'failed'

  return { name: status.context, state, summary: status.description, tests: parseTestCounts(status.description) }
}

/** The checks of one commit, added up. */
export function aggregate(sha: string, checks: Check[]): Pipeline {
  const pipeline: Pipeline = {
    sha,
    total: checks.length,
    queued: 0,
    running: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: null,
    checks,
  }

  for (const check of checks) {
    if (check.state === 'queued') pipeline.queued += 1
    else if (check.state === 'running') pipeline.running += 1
    else if (check.state === 'passed') pipeline.passed += 1
    else if (check.state === 'failed') pipeline.failed += 1
    else pipeline.skipped += 1

    if (check.tests) {
      const tests = pipeline.tests ?? { passed: 0, failed: 0, skipped: 0 }
      pipeline.tests = {
        passed: tests.passed + check.tests.passed,
        failed: tests.failed + check.tests.failed,
        skipped: tests.skipped + check.tests.skipped,
      }
    }
  }

  return pipeline
}

/** The pipeline's state in one word, worst first. */
export function verdict(pipeline: Pipeline): 'failed' | 'running' | 'passed' | 'none' {
  if (pipeline.total === 0) return 'none'
  if (pipeline.failed > 0) return 'failed'
  if (pipeline.running + pipeline.queued > 0) return 'running'

  return 'passed'
}

type RawDeployment = { id: number; environment: string; ref: string; sha: string; created_at: string }

/** The newest deployment of each environment, those of `sha` first. */
export function latestPerEnvironment(list: RawDeployment[], sha: string | null): RawDeployment[] {
  const newest = new Map<string, RawDeployment>()

  for (const one of list) {
    const seen = newest.get(one.environment)
    if (!seen || one.created_at > seen.created_at) newest.set(one.environment, one)
  }

  return [...newest.values()].sort((a, b) => Number(b.sha === sha) - Number(a.sha === sha))
}

export function deploymentOf(raw: RawDeployment, state: string, url: string | null, at: string, sha: string | null): Deployment {
  return { environment: raw.environment, state, ref: raw.ref, isThisCommit: raw.sha === sha, url, at }
}

/** The auto refresh intervals the button cycles through; 0 is off. */
export const INTERVALS: readonly number[] = [0, 30_000, 60_000, 5 * 60_000, 15 * 60_000]

/** The interval after `ms` in the cycle; an unknown one starts it over. */
export function nextInterval(ms: number): number {
  return INTERVALS[(INTERVALS.indexOf(ms) + 1) % INTERVALS.length] ?? 0
}

export function intervalLabel(ms: number): string {
  if (ms === 0) return 'off'

  return ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`
}

/** The status, lower-cased headers and body of what `gh api --include` printed, or null when it printed none. */
export function parseGhResponse(text: string): { status: number; headers: Record<string, string>; body: string } | null {
  const status = /^HTTP\/\S+\s+(\d{3})/.exec(text)
  if (!status) return null

  const split = /\r?\n\r?\n/.exec(text)
  const head = split ? text.slice(0, split.index) : text
  const body = split ? text.slice(split.index + split[0].length) : ''
  const headers: Record<string, string> = {}
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }

  return { status: Number(status[1]), headers, body }
}
