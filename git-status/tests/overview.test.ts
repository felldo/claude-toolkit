import { describe, expect, test } from 'claude-code/testing'

import type { Check, Deployment, LocalStatus, Pipeline, PullDetails, PullRequest } from '../types'

import { aggregate, pullDetailsOf } from '../hooks/parse'
import { blockers, checklist, fitBlockers, fitSegments, groupChecks, groupNames, overallState, reviewTally, reviewersOf } from '../hooks/overview'
import type { View } from '../hooks/overview'

const LOCAL: LocalStatus = {
  branch: 'feature/x',
  sha: 'abc1234def',
  upstream: 'origin/feature/x',
  pushedSha: 'abc1234def',
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  lastCommit: 'add the thing',
}

const DETAILS: PullDetails = {
  reviewDecision: 'APPROVED',
  requested: [],
  reviews: [{ author: 'ann', state: 'APPROVED', comments: 0 }],
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  unresolvedThreads: 0,
}

const check = (name: string, state: Check['state'], failed = 0): Check => ({
  name,
  state,
  summary: null,
  tests: failed ? { passed: 0, failed, skipped: 0 } : null,
  url: null,
  startedAt: null,
  completedAt: null,
})

const pr = (details: Partial<PullDetails> | null = {}, extra: Partial<PullRequest> = {}): PullRequest => ({
  number: 42,
  title: 'Add pane',
  author: 'me',
  url: 'https://github.com/acme/app/pull/42',
  headSha: 'abc1234def',
  base: 'main',
  details: details && { ...DETAILS, ...details },
  ...extra,
})

const passing: Pipeline = aggregate('abc1234def', [check('unit', 'passed'), check('lint', 'passed')])
const running: Pipeline = aggregate('abc1234def', [check('unit', 'passed'), check('e2e', 'running')])

/** 30 checks, 15 of them failed: e2e 11 of 16, lint, unit 3 of 3. */
const broken: Pipeline = aggregate('abc1234def', [
  ...Array.from({ length: 16 }, (_, i) => check(`e2e (${i + 1}/16)`, i < 11 ? 'failed' : 'passed', i < 11 ? 1 : 0)),
  check('lint', 'failed'),
  ...['a', 'b', 'c'].map(shard => check(`unit (${shard})`, 'failed', 2)),
  ...Array.from({ length: 10 }, (_, i) => check(`build (${i + 1})`, 'passed')),
])

const staging: Deployment = { environment: 'staging', state: 'failure', ref: 'feature/x', isThisCommit: true, url: null, at: '2026-10-01T10:00:00Z' }

const view = (over: Partial<View> = {}): View => ({ local: LOCAL, pr: pr(), pipeline: passing, deployments: [], ...over })

const worst = view({
  local: { ...LOCAL, conflicted: 3, ahead: 3, modified: 2 },
  pr: pr({
    reviewDecision: 'CHANGES_REQUESTED',
    requested: ['ana'],
    reviews: [
      { author: 'mira', state: 'CHANGES_REQUESTED', comments: 3 },
      { author: 'jonas', state: 'CHANGES_REQUESTED', comments: 1 },
    ],
    unresolvedThreads: 14,
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
  }),
  pipeline: broken,
  deployments: [staging],
})

describe('the overall state', () => {
  test('local trouble comes first', () => {
    expect(overallState(worst)).toBe('CONFLICT')
    expect(overallState(view({ local: { ...LOCAL, ahead: 2 } }))).toBe('UNPUSHED')
    expect(overallState(view({ local: { ...LOCAL, upstream: null, pushedSha: null }, pr: null }))).toBe('UNPUSHED')
  })

  test('without a PR the working tree decides', () => {
    expect(overallState(view({ pr: null, pipeline: null }))).toBe('CLEAN')
    expect(overallState(view({ pr: null, pipeline: null, local: { ...LOCAL, untracked: 4 } }))).toBe('CLEAN')
    expect(overallState(view({ pr: null, pipeline: null, local: { ...LOCAL, modified: 1 } }))).toBe('UNCOMMITTED')
    expect(overallState(view({ pr: null, pipeline: null, local: { ...LOCAL, branch: null, upstream: null } }))).toBe('CLEAN')
  })

  test('a PR is blocked by failed checks, changes, threads, conflicts or a stale base', () => {
    expect(overallState(view({ pipeline: broken }))).toBe('BLOCKED')
    expect(overallState(view({ pr: pr({ reviewDecision: 'CHANGES_REQUESTED' }) }))).toBe('BLOCKED')
    expect(overallState(view({ pr: pr({ unresolvedThreads: 1 }) }))).toBe('BLOCKED')
    expect(overallState(view({ pr: pr({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' }) }))).toBe('BLOCKED')
    expect(overallState(view({ pr: pr({ mergeState: 'BEHIND' }) }))).toBe('BLOCKED')
    expect(overallState(view({ pr: pr({ reviewDecision: null, mergeState: 'BLOCKED' }) }))).toBe('BLOCKED')
  })

  test('running checks, reviews still to come, drafts and unknown details', () => {
    expect(overallState(view({ pipeline: running }))).toBe('CI RUNNING')
    expect(overallState(view({ pr: pr({ reviewDecision: null, requested: ['bob'] }) }))).toBe('NEEDS REVIEW')
    expect(overallState(view({ pr: pr({ reviewDecision: 'REVIEW_REQUIRED', mergeState: 'BLOCKED' }) }))).toBe('NEEDS REVIEW')
    expect(overallState(view({ pr: pr({}, { isDraft: true }) }))).toBe('DRAFT')
    expect(overallState(view({ pr: pr(null) }))).toBe('PR OPEN')
    expect(overallState(view({ pr: pr({ mergeState: 'UNKNOWN', mergeable: 'UNKNOWN' }) }))).toBe('PR OPEN')
  })

  test('ready once GitHub says it can merge', () => {
    expect(overallState(view())).toBe('READY')
    expect(overallState(view({ pr: pr({ mergeState: 'HAS_HOOKS' }) }))).toBe('READY')
    expect(overallState(view({ pr: pr({ reviewDecision: null, reviews: [] }) }))).toBe('READY')
  })
})

describe('blockers', () => {
  test('in full', () => {
    expect(blockers(worst, false).map(said => said.text)).toEqual([
      '✗ 3 files with local conflicts',
      '↑3 not pushed',
      '2 uncommitted changes',
      '✗ 15 checks failed (e2e ×11, lint, unit ×3)',
      '✗ changes requested by mira, jonas',
      '○ waiting for ana',
      '14 open threads',
      '✗ conflicts with main',
      'staging failure',
    ])
  })

  test('compact', () => {
    expect(blockers(worst, true).map(said => said.text)).toEqual([
      '✗3 conflicts',
      '↑3',
      '✚2',
      '✗ CI 15/30',
      '✗ changes ×2',
      '○ review ×1',
      '14 threads',
      '✗ merge conflict',
      'staging ✗',
    ])
  })

  test('a branch never pushed, behind its upstream, with running checks', () => {
    expect(blockers(view({ local: { ...LOCAL, upstream: null, pushedSha: null, modified: 3 }, pr: null, pipeline: null }), false).map(said => said.text)).toEqual([
      'not pushed yet',
      '3 uncommitted changes',
    ])
    expect(blockers(view({ local: { ...LOCAL, behind: 2 }, pipeline: running }), false).map(said => said.text)).toEqual([
      '↓2 to pull',
      '● checks running 1/2',
    ])
    expect(blockers(view({ pr: pr({ mergeState: 'BEHIND' }) }), true).map(said => said.text)).toEqual(['↓ behind'])
  })

  test('full when all fit, else compact, else the rest as +N', () => {
    const full = [{ text: 'aaaaaaaaaa' }, { text: 'bbbbbbbbbb' }, { text: 'cccccccccc' }]
    const compact = [{ text: 'aaa' }, { text: 'bbb' }, { text: 'ccc' }]
    expect(fitBlockers(full, compact, 34)).toEqual({ shown: full, hidden: 0 })
    expect(fitBlockers(full, compact, 33)).toEqual({ shown: compact, hidden: 0 })
    // two of them and the room for `  +1`
    expect(fitBlockers(full, compact, 12)).toEqual({ shown: compact.slice(0, 2), hidden: 1 })
    expect(fitBlockers(full, compact, 11)).toEqual({ shown: compact.slice(0, 1), hidden: 2 })
    expect(fitBlockers(full, compact, 1)).toEqual({ shown: [], hidden: 3 })
  })
})

describe('the merge checklist', () => {
  const look = (list: ReturnType<typeof checklist>) => list.items.map(item => [item.state, item.text])

  test('all done', () => {
    const list = checklist(view())
    expect(list.title).toBe('To merge #42 into main')
    expect(look(list)).toEqual([
      ['done', 'No local conflicts'],
      ['done', 'Working tree clean'],
      ['done', 'Pushed'],
      ['done', 'Pull request #42'],
      ['done', 'Checks passed'],
      ['done', 'Approved'],
      ['done', 'No open threads'],
      ['done', 'Up to date with main'],
    ])
  })

  test('the worst case says what is wrong and how to fix it', () => {
    const list = checklist(worst)
    expect(look(list)).toEqual([
      ['failed', '3 files with local conflicts'],
      ['warning', 'Uncommitted changes'],
      ['failed', '3 commits not pushed'],
      ['done', 'Pull request #42'],
      ['failed', '15 of 30 checks failed'],
      ['failed', 'Changes requested'],
      ['failed', '14 open threads'],
      ['failed', 'Conflicts with main'],
    ])
    expect(list.items.map(item => item.hint ?? '')).toEqual(['git status', 'git commit', 'git push', '', '', '', '', 'git merge origin/main'])
    expect(list.items[5]?.detail).toBe('mira, jonas')
  })

  test('without a PR', () => {
    const list = checklist(view({ local: { ...LOCAL, branch: 'fix/y', upstream: null, pushedSha: null }, pr: null, pipeline: null }))
    expect(list.title).toBe('To open a pull request for fix/y')
    expect(list.items.slice(2).map(item => [item.state, item.text, item.hint])).toEqual([
      ['failed', 'Not pushed yet', 'git push -u origin fix/y'],
      ['todo', 'No pull request yet', 'gh pr create'],
    ])
    expect(checklist(view({ local: { ...LOCAL, ahead: 1 }, pr: null, pipeline: null })).items[2]?.text).toBe('1 commit not pushed')
  })

  test('behind the base, checks running, a review to wait for', () => {
    const behind = checklist(view({ pr: pr({ mergeState: 'BEHIND' }, { base: 'develop' }) }))
    expect(behind.items.at(-1)).toEqual({ state: 'warning', text: 'Behind develop', hint: 'git pull --rebase origin develop' })
    expect(checklist(view({ pipeline: running })).items[4]).toEqual({ state: 'waiting', text: 'Checks running', detail: '1/2' })
    expect(checklist(view({ pr: pr({ reviewDecision: null, requested: ['bob'] }) })).items[5]).toEqual({
      state: 'waiting',
      text: 'Waiting for review',
      detail: 'bob',
    })
  })

  test('the default branch and a PR without details', () => {
    const main = checklist(view({ local: { ...LOCAL, branch: 'main', upstream: 'origin/main' }, pr: null, pipeline: null }))
    expect(main.title).toBe('main')
    expect(main.items.length).toBe(3)
    expect(checklist(view({ pr: pr(null) })).items.at(-1)).toEqual({ state: 'todo', text: 'Review and merge state unknown' })
  })
})

describe('checks in groups', () => {
  test('matrix runs share a group, in order of first sight, worst state wins', () => {
    const groups = groupChecks([
      check('e2e (1/16)', 'failed', 3),
      check('lint', 'failed'),
      check('e2e (2/16)', 'passed'),
      check('docs', 'skipped'),
      check('e2e (3/16)', 'failed', 2),
      check('package', 'neutral'),
    ])
    expect(groups.map(group => [group.name, group.checks.length, group.state, group.failedTests])).toEqual([
      ['e2e', 3, 'failed', 5],
      ['lint', 1, 'failed', 0],
      ['docs', 1, 'skipped', 0],
      ['package', 1, 'neutral', 0],
    ])
    expect(groups[0]?.variants).toEqual(['1/16', '2/16', '3/16'])
    expect(groupChecks([check('e2e (1)', 'passed'), check('e2e (2)', 'running'), check('e2e (3)', 'queued')])[0]?.state).toBe('running')
  })

  test('names with a count', () => {
    expect(groupNames([check('e2e (1/2)', 'failed'), check('e2e (2/2)', 'failed'), check('lint', 'failed')])).toEqual(['e2e ×2', 'lint'])
  })
})

describe('reviewers', () => {
  const details: PullDetails = {
    ...DETAILS,
    reviewDecision: 'CHANGES_REQUESTED',
    requested: ['ana', 'ben'],
    reviews: [
      { author: 'mira', state: 'CHANGES_REQUESTED', comments: 3 },
      { author: 'jonas', state: 'CHANGES_REQUESTED', comments: 1 },
      { author: 'lea', state: 'APPROVED', comments: 0 },
      { author: 'tom', state: 'COMMENTED', comments: 5 },
      { author: 'ana', state: 'COMMENTED', comments: 2 },
    ],
  }

  test('each with state and comments; asked again counts as pending', () => {
    expect(reviewersOf(details)).toEqual([
      { name: 'mira', state: 'changes', comments: 3 },
      { name: 'jonas', state: 'changes', comments: 1 },
      { name: 'lea', state: 'approved', comments: 0 },
      { name: 'tom', state: 'commented', comments: 5 },
      { name: 'ana', state: 'pending', comments: 2 },
      { name: 'ben', state: 'pending', comments: 0 },
    ])
    expect(reviewTally(reviewersOf(details))).toEqual({ approved: 1, changes: 2, commented: 1, pending: 2 })
  })

  test('comment counts come from GraphQL, 0 when missing', () => {
    const pull = {
      reviewDecision: null,
      mergeable: 'MERGEABLE' as const,
      mergeStateStatus: 'CLEAN',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      reviewRequests: { nodes: [] },
      latestReviews: {
        nodes: [
          { author: { login: 'mira' }, state: 'COMMENTED', comments: { totalCount: 4 } },
          { author: { login: 'tom' }, state: 'APPROVED' },
        ],
      },
      reviewThreads: { nodes: [] },
    }
    expect(pullDetailsOf(pull).reviews.map(review => review.comments)).toEqual([4, 0])
  })
})

describe('segments that fit', () => {
  const seg = (priority: number, text: string, short?: string) => ({ priority, parts: [{ text }], short: short ? [{ text: short }] : undefined })
  // widths 11, 12, 10, 9, 5, 6: 53 and 5 gaps of 2
  const segments = [seg(0, '⎇ feature/x'), seg(1, '#42 Add pane', '#42'), seg(0, 'CI ✓ 30/30', '✓'), seg(3, '13 issues'), seg(3, '9 PRs'), seg(4, 'v1.4.0')]
  const texts = (width: number) => {
    const fitted = fitSegments(segments, width)

    return [fitted.segments.map(parts => parts.map(part => part.text).join('')), fitted.hidden]
  }

  test('the least important go first, the last of equals before the first', () => {
    expect(texts(63)).toEqual([['⎇ feature/x', '#42 Add pane', 'CI ✓ 30/30', '13 issues', '9 PRs', 'v1.4.0'], 0])
    expect(texts(62)).toEqual([['⎇ feature/x', '#42 Add pane', 'CI ✓ 30/30', '13 issues', '9 PRs'], 0])
    expect(texts(50)).toEqual([['⎇ feature/x', '#42 Add pane', 'CI ✓ 30/30', '13 issues'], 0])
    expect(texts(40)).toEqual([['⎇ feature/x', '#42 Add pane', 'CI ✓ 30/30'], 0])
  })

  test('short forms before anything important is dropped, a dropped essential is counted', () => {
    expect(texts(30)).toEqual([['⎇ feature/x', '#42', '✓'], 0])
    expect(texts(15)).toEqual([['⎇ feature/x', '✓'], 0])
    expect(texts(12)).toEqual([['⎇ feature/x'], 1])
    expect(texts(5)).toEqual([[], 2])
  })

  test('a wider gap', () => {
    expect(fitSegments(segments.slice(0, 2), 26, 3).segments.length).toBe(2)
    expect(fitSegments(segments.slice(0, 2), 25, 3).segments.map(parts => parts[0]?.text)).toEqual(['⎇ feature/x', '#42'])
  })
})
