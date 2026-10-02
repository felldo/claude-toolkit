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

export type Item = { number: number; title: string; author: string; isDraft?: boolean }

export type TestCounts = { passed: number; failed: number; skipped: number }

export type Check = {
  name: string
  state: 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'neutral'
  summary: string | null
  tests: TestCounts | null
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

export type PullRequest = Item & { url: string; headSha: string; base: string }

export type Remote = {
  repo: string | null
  openIssues: number | null
  openPulls: number | null
  issues: Item[]
  pulls: Item[]
  pr: PullRequest | null
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
