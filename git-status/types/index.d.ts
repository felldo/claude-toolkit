export type LocalStatus = {
  branch: string | null
  sha: string | null
  upstream: string | null
  /** The upstream's commit: the last one pushed. */
  pushedSha: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicted: number
  lastCommit: string | null
}

export type Item = { number: number; title: string; author: string; isDraft?: boolean; isPull?: boolean; url?: string }

export type TestCounts = { passed: number; failed: number; skipped: number }

export type Check = {
  name: string
  state: 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'neutral'
  summary: string | null
  tests: TestCounts | null
  url: string | null
  startedAt: string | null
  completedAt: string | null
}

export type Pipeline = {
  sha: string
  total: number
  queued: number
  running: number
  passed: number
  failed: number
  skipped: number
  tests: TestCounts | null
  checks: Check[]
}

export type Deployment = {
  environment: string
  state: string
  ref: string
  isThisCommit: boolean
  url: string | null
  at: string
}

export type Review = { author: string; state: string }

/** What GraphQL says about the PR beyond the REST list: reviews, merge state and size. */
export type PullDetails = {
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  requested: string[]
  reviews: Review[]
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeState: string
  additions: number
  deletions: number
  changedFiles: number
  unresolvedThreads: number
}

export type PullRequest = Item & { url: string; headSha: string; base: string; details: PullDetails | null }

export type Release = { tag: string; isRelease: boolean; publishedAt: string | null; url: string; commitsSince: number | null }

export type Remote = {
  repo: string | null
  openIssues: number | null
  openPulls: number | null
  issues: Item[]
  pulls: Item[]
  pr: PullRequest | null
  assigned: Item[]
  reviewRequests: Item[]
  release: Release | null
  pipeline: Pipeline | null
  deployments: Deployment[]
  rateRemaining: number | null
  error: string | null
}

export type Snapshot = {
  local: LocalStatus | null
  remote: Remote | null
  updatedAt: number
  isRefreshing: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'git-status': { snapshot: Snapshot; isExpanded: boolean; intervalMs: number }
  }
}
