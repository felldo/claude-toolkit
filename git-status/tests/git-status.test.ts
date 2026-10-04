import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import type { PullDetails } from '../types'

import { aggregate, checkFromRun, checkTime, ciChange, intervalLabel, mergeSummary, nextInterval, parseGhResponse, reviewSummary, countFromLink, latestPerEnvironment, parsePorcelain, parseRemote, parseTestCounts, verdict } from '../hooks/parse'

describe('parsing', () => {
  test('remotes in every spelling', () => {
    expect(parseRemote('git@github.com:felldo/claude-mods.git')).toBe('felldo/claude-mods')
    expect(parseRemote('https://github.com/felldo/claude-mods')).toBe('felldo/claude-mods')
    expect(parseRemote('https://github.com/felldo/claude-mods.git/')).toBe('felldo/claude-mods')
    expect(parseRemote('ssh://git@github.com/felldo/claude-mods.git')).toBe('felldo/claude-mods')
    expect(parseRemote('https://gitlab.com/felldo/claude-mods.git')).toBe(null)
  })

  test('porcelain v2 with branch, upstream and changes', () => {
    const status = parsePorcelain(
      [
        '# branch.oid 0123456789abcdef',
        '# branch.head feature/x',
        '# branch.upstream origin/feature/x',
        '# branch.ab +2 -1',
        '1 M. N... 100644 100644 100644 a b file1',
        '1 .M N... 100644 100644 100644 a b file2',
        '1 MM N... 100644 100644 100644 a b file3',
        'u UU N... 100644 100644 100644 100644 a b c file4',
        '? new.txt',
      ].join('\n'),
    )
    expect(status).toEqual(
      expect.objectContaining({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1, staged: 2, modified: 2, conflicted: 1, untracked: 1 }),
    )
  })

  test('detached head and a fresh repository', () => {
    const status = parsePorcelain('# branch.oid (initial)\n# branch.head (detached)\n')
    expect(status.branch).toBe(null)
    expect(status.sha).toBe(null)
  })

  test('counts from the link header', () => {
    const link = '<https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=17>; rel="last"'
    expect(countFromLink(link, 1)).toBe(17)
    expect(countFromLink(undefined, 1)).toBe(1)
    expect(countFromLink(undefined, 0)).toBe(0)
  })

  test('test counts only when a check states them', () => {
    expect(parseTestCounts('1,204 passed, 3 failed, 12 skipped')).toEqual({ passed: 1204, failed: 3, skipped: 12 })
    expect(parseTestCounts('Tests: 42 tests passed')).toEqual({ passed: 42, failed: 0, skipped: 0 })
    expect(parseTestCounts('Build succeeded')).toBe(null)
    expect(parseTestCounts(null)).toBe(null)
  })

  test('checks add up and the worst one wins', () => {
    const checks = [
      checkFromRun({ name: 'unit', status: 'completed', conclusion: 'success', output: { title: '10 passed' } }),
      checkFromRun({ name: 'e2e', status: 'in_progress', conclusion: null }),
      checkFromRun({ name: 'lint', status: 'queued', conclusion: null }),
    ]
    const pipeline = aggregate('abc', checks)
    expect(pipeline).toEqual(expect.objectContaining({ total: 3, passed: 1, running: 1, queued: 1, failed: 0 }))
    expect(pipeline.tests).toEqual({ passed: 10, failed: 0, skipped: 0 })
    expect(verdict(pipeline)).toBe('running')

    const failed = aggregate('abc', [...checks, checkFromRun({ name: 'x', status: 'completed', conclusion: 'timed_out' })])
    expect(verdict(failed)).toBe('failed')
    expect(verdict(aggregate('abc', []))).toBe('none')
  })

  test('what gh api --include prints', () => {
    const response = parseGhResponse('HTTP/2.0 200 OK\r\nLink: <x?page=3>; rel="last"\r\nX-Ratelimit-Remaining: 12\r\n\r\n[1,2]')
    expect(response).toEqual({ status: 200, headers: { link: '<x?page=3>; rel="last"', 'x-ratelimit-remaining': '12' }, body: '[1,2]' })
    expect(parseGhResponse('HTTP/2.0 404 Not Found\n\n{}')?.status).toBe(404)
    expect(parseGhResponse('')).toBe(null)
  })

  test('check times: finished, running, never started', () => {
    expect(checkTime({ state: 'passed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T01:03:00Z' }, 0)).toBe('1h 3m')
    expect(checkTime({ state: 'running', startedAt: '2026-01-01T00:00:00Z', completedAt: null }, Date.parse('2026-01-01T00:00:45Z'))).toBe('since 45s')
    expect(checkTime({ state: 'queued', startedAt: null, completedAt: null }, 0)).toBe('–')
  })

  test('review and merge state in a few words', () => {
    const details: PullDetails = {
      reviewDecision: null,
      requested: [],
      reviews: [],
      mergeable: 'MERGEABLE',
      mergeState: 'CLEAN',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      unresolvedThreads: 0,
    }
    expect(reviewSummary({ ...details, reviewDecision: 'APPROVED', reviews: [{ author: 'ann', state: 'APPROVED', comments: 0 }] }).text).toBe(
      '✓ approved by ann',
    )
    expect(reviewSummary({ ...details, requested: ['bob', 'team'] }).text).toBe('○ waiting for bob, team')
    expect(mergeSummary(details, 'main').text).toBe('✓ ready to merge')
    expect(mergeSummary({ ...details, mergeState: 'BEHIND' }, 'main').text).toBe('↓ behind main, update the branch')
    expect(mergeSummary({ ...details, mergeable: 'CONFLICTING' }, 'main').text).toBe('✗ conflicts with main')
  })

  test('a toast only when the same commit finishes or breaks', () => {
    const run = (state: 'running' | 'passed' | 'failed', name = 'e2e') =>
      checkFromRun({ name, status: state === 'running' ? 'in_progress' : 'completed', conclusion: state === 'passed' ? 'success' : state === 'failed' ? 'failure' : null })
    const running = aggregate('abc', [run('passed', 'unit'), run('running')])
    expect(ciChange(running, aggregate('abc', [run('passed', 'unit'), run('passed')]), 'PR #12')).toBe('CI passed ✓ PR #12 (2/2)')
    expect(ciChange(running, aggregate('abc', [run('passed', 'unit'), run('failed')]), 'PR #12')).toBe('CI failed ✗ PR #12: e2e')
    expect(ciChange(running, aggregate('abc', [run('passed', 'unit'), run('running')]), 'PR #12')).toBe(null)
    expect(ciChange(running, aggregate('other', [run('passed')]), 'PR #12')).toBe(null)
    expect(ciChange(null, running, 'PR #12')).toBe(null)
  })

  test('the auto refresh button cycles off, 30s, 1m, 5m, 15m', () => {
    const seen = [0]
    for (let i = 0; i < 5; i += 1) seen.push(nextInterval(seen[seen.length - 1] ?? 0))
    expect(seen.map(intervalLabel)).toEqual(['off', '30s', '1m', '5m', '15m', 'off'])
    expect(nextInterval(42)).toBe(0)
  })

  test('newest deployment per environment, this commit first', () => {
    const latest = latestPerEnvironment(
      [
        { id: 1, environment: 'prod', ref: 'main', sha: 'old', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, environment: 'prod', ref: 'main', sha: 'new', created_at: '2026-02-01T00:00:00Z' },
        { id: 3, environment: 'preview', ref: 'feat', sha: 'mine', created_at: '2026-01-15T00:00:00Z' },
      ],
      'mine',
    )
    expect(latest.map(one => one.id)).toEqual([3, 2])
  })
})

const ran = (exitCode: number, stdout: string) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const PANE = {
  plugin: 'git-status',
  component: 'Pane',
  requestId: 'git-status',
  props: { title: 'Git', isFocused: true, bodyColumns: 80, placement: 'dock' } as unknown as RenderPropsOf['Pane'],
} as const

const BAND = {
  plugin: 'git-status',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as unknown as RenderPropsOf['AbovePrompt'],
} as const

const GIT: Record<string, string> = {
  status: '# branch.oid 1111111aaaa\n# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +1 -0\n? a.txt\n',
  log: 'add the thing',
  'rev-parse': '0000000bbbb',
  remote: 'git@github.com:acme/app.git',
}

const PULL = {
  reviewDecision: 'CHANGES_REQUESTED',
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
  additions: 120,
  deletions: 45,
  changedFiles: 8,
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'dan' } }, { requestedReviewer: null }] },
  latestReviews: { nodes: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED', comments: { totalCount: 3 } }] },
  reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] },
}

const GITHUB: [RegExp, unknown, Record<string, string>?][] = [
  [
    /\/search\/issues\?q=.*assignee%3A%40me/,
    { total_count: 2, items: [{ number: 9, title: 'Fix login', user: { login: 'me' }, html_url: 'https://github.com/acme/app/issues/9' }] },
  ],
  [
    /\/search\/issues\?q=.*review-requested%3A%40me/,
    {
      total_count: 6,
      items: [{ number: 20, title: 'Refactor store', user: { login: 'cat' }, pull_request: {}, html_url: 'https://github.com/acme/app/pull/20' }],
    },
  ],
  [/\/releases\/latest$/, { tag_name: 'v1.4.0', published_at: '2026-09-20T08:00:00Z', html_url: 'https://github.com/acme/app/releases/tag/v1.4.0' }],
  [/\/compare\/v1\.4\.0\.\.\.cafe123$/, { ahead_by: 3 }],
  [/\/repos\/acme\/app$/, { open_issues_count: 9 }],
  [/\/pulls\?state=open&per_page=1$/, [{}], { Link: '<https://api.github.com/x?per_page=1&page=4>; rel="last"' }],
  [
    /\/issues\?/,
    [
      { number: 7, title: 'Crash on start', user: { login: 'ann' } },
      { number: 12, title: 'Add pane', user: { login: 'bob' }, pull_request: {} },
    ],
  ],
  [/\/pulls\?state=open&head=acme:feature%2Fx$/, [{ number: 12, title: 'Add pane', user: { login: 'bob' }, html_url: 'https://github.com/acme/app/pull/12', head: { sha: 'cafe123', ref: 'feature/x' }, base: { ref: 'main' } }]],
  [
    /\/commits\/cafe123\/check-runs/,
    {
      check_runs: [
        {
          name: 'unit tests',
          status: 'completed',
          conclusion: 'success',
          output: { title: '128 passed, 2 skipped' },
          html_url: 'https://github.com/acme/app/actions/runs/1/job/2',
          started_at: '1970-01-01T00:00:00Z',
          completed_at: '1970-01-01T00:02:14Z',
        },
        { name: 'e2e', status: 'in_progress', conclusion: null, output: {}, started_at: '1970-01-01T00:12:00Z', completed_at: null },
      ],
    },
  ],
  [/\/commits\/cafe123\/status/, { statuses: [] }],
  [/\/deployments\?/, [{ id: 5, environment: 'preview', ref: 'feature/x', sha: 'cafe123', created_at: '2026-10-01T10:00:00Z' }]],
  [/\/deployments\/5\/statuses/, [{ state: 'success', environment_url: 'https://preview.acme.dev', created_at: '2026-10-01T10:05:00Z' }]],
]

test('the pane shows branch, PR, pipeline, tests, deployments, issues and PRs', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, async () => h('Box', null) as RenderElement)
  const asked: string[] = []

  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return ran(0, GIT[e.argv[1] ?? ''] ?? '')
    if (e.argv[0] !== 'gh') throw new Error('not installed')
    if (e.argv[1] === 'auth') return ran(0, '')
    if (e.argv[2] === 'graphql') return ran(0, JSON.stringify({ data: { repository: { pullRequest: PULL } } }))

    const path = e.argv[3] ?? ''
    asked.push(path)
    const found = GITHUB.find(([pattern]) => pattern.test(path))
    if (!found) return ran(1, 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}')
    const headers = Object.entries({ 'X-Ratelimit-Remaining': '4990', ...found[2] }).map(([name, value]) => `${name}: ${value}\r\n`)

    return ran(0, `HTTP/2.0 200 OK\r\n${headers.join('')}\r\n${JSON.stringify(found[1])}`)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: "refresh" })

    // links read blue, underlined and with an arrow
    expect(await ui.find({ type: 'Text', text: /^log ↗$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Link' })).length).toBe(5)
    expect(await ui.find({ type: 'Text', text: /^v1\.4\.0 ↗$/ })).toBeDefined()
    for (const text of [
      /feature\/x/,
      /#12/,
      /Add pane/,
      /128 passed/,
      /1 running/,
      /preview/,
      /Open pull requests \(4\)/,
      /Open issues \(5\)/,
      /Crash on start/,
      /4990 API calls left/,
      /changes requested by ann/,
      /conflicts with main/,
      /^\+120$/,
      /8 files/,
      /2 unresolved threads/,
      /^2m 14s$/,
      /^since 4m 40s$/,
      /^Time$/,
      /Fix login/,
      /PR Refactor store/,
      /Assigned to you \(2\)/,
      /Review requested from you \(6\)/,
      /3 commits since/,
      /^Author$/,
      /^ann$/,
      /^128✓ 0✗$/,
      /^Environment$/,
      /^this commit$/,
    ]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  }
  expect(asked.length).toBeGreaterThan(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    for (const text of [
      // the verdict, then the blockers: compact, as all of them in full do not fit 120 columns
      /^ ↑ UNPUSHED $/,
      /^↑1$/,
      /^● CI 1\/2$/,
      /^✗ changes ×1$/,
      /^○ review ×1$/,
      /^2 threads$/,
      /^✗ merge conflict$/,
      // then branch, working tree, PR and what the repository holds for you
      /^⎇ feature\/x → origin\/feature\/x ↑1$/,
      /^●0 ✚0 \?1$/,
      /^#12 Add pane → main$/,
      /^5 issues \(2 assigned\)$/,
      /^4 PRs \(6 to review\)$/,
    ]) {
      expect(await band.find({ type: 'Text', text })).toBeDefined()
    }
    for (const text of [/Fix login/, /^To merge/, /^BRANCH$/]) {
      expect(await band.find({ type: 'Text', text })).toBeUndefined()
    }
    expect(await band.find({ key: 'auto' })).toBeUndefined()
    await band.press({ key: 'git-details' })
    for (const text of [
      // the checklist, each step worded for its state, with the command that fixes it
      /^To merge #12 into main$/,
      /^No local conflicts$/,
      /^1 commit not pushed$/,
      /^git push$/,
      /^Conflicts with main$/,
      /^git merge origin\/main$/,
      /^Changes requested$/,
      // the reviewers with their comments
      /^ann$/,
      /^3 comments$/,
      /^dan$/,
      // the checks not done yet
      /^e2e$/,
      // what waits for you: the first few and how many more
      /Refactor store/,
      /^… 5 more$/,
      /Fix login/,
      /^… 1 more$/,
      /4990 API calls left/,
    ]) {
      expect(await band.find({ type: 'Text', text })).toBeDefined()
    }
    expect(await band.find({ type: 'Text', text: /^No open threads$|^Pushed$/ })).toBeUndefined()
    expect((await band.find({ key: 'auto' }))?.text).toBe('Auto 1m')
    await band.press({ key: 'auto' })
    expect((await band.find({ key: 'auto' }))?.text).toBe('Auto 5m')
    for (let i = 0; i < 4; i += 1) await band.press({ key: 'auto' })
    await band.press({ key: 'git-details' })
    expect(await band.find({ key: 'auto' })).toBeUndefined()
    expect(await band.find({ key: 'refresh' })).toBeUndefined()
    await band.unmount()
  }
})

test('outside GitHub the pane says so', async ($, on) => {
  mock.clock(on)
  mock.env(on, {})
  on('process.run', async (_$, e) => {
    const stdout = e.argv[1] === 'remote' ? 'https://gitlab.com/x/y.git' : e.argv[1] === 'status' ? '# branch.head main\n' : ''

    return ran(e.argv[0] === 'git' ? 0 : 1, stdout)
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /No GitHub remote/ })).toBeDefined()
  await ui.unmount()
})

test('without gh the band says how to get it', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, async () => h('Box', null) as RenderElement)
  on('process.run', async (_$, e) => {
    if (e.argv[0] !== 'git') throw new Error('not installed')

    return ran(0, GIT[e.argv[1] ?? ''] ?? '')
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /needs the GitHub CLI: winget install GitHub.cli/ })).toBeDefined()
  await band.unmount()
})

test('a gh that is not logged in says so', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, async () => h('Box', null) as RenderElement)
  on('process.run', async (_$, e) => ran(e.argv[0] === 'git' ? 0 : 1, e.argv[0] === 'git' ? GIT[e.argv[1] ?? ''] ?? '' : ''))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /gh is not logged in: run gh auth login/ })).toBeDefined()
  await ui.unmount()
})

test('empty sections keep their title, not their table', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, async () => h('Box', null) as RenderElement)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return ran(0, GIT[e.argv[1] ?? ''] ?? '')
    if (e.argv[1] === 'auth') return ran(0, '')
    const path = e.argv[3] ?? ''
    const body = /\/repos\/acme\/app$/.test(path) ? { open_issues_count: 0 } : /check-runs/.test(path) ? { check_runs: [] } : /\/status/.test(path) ? { statuses: [] } : []

    return ran(0, `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(body)}`)
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  for (const text of [
    /^Deployments \(0\)$/,
    /^Open pull requests \(0\)$/,
    /^Open issues \(0\)$/,
    /^Assigned to you \(0\)$/,
    /^Review requested from you \(0\)$/,
    /^Latest release \(none\)$/,
  ]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  for (const text of [/^Environment$/, /^Author$/, /^No deployments/, /^No open (issues|pull requests)\./, /^Nothing assigned/, /^No release/]) {
    expect(await ui.find({ type: 'Text', text })).toBeUndefined()
  }
  // no PR on this branch: no pipeline
  expect(await ui.find({ type: 'Text', text: /^Pipeline$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Check$/ })).toBeUndefined()
  await ui.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^0 issues$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /PR #|CI|no checks/ })).toBeUndefined()
  await band.unmount()
})

test('a calm branch gets a short badge and one line of segments', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, async () => h('Box', null) as RenderElement)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      const clean = '# branch.oid 1111111aaaa\n# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +0 -0\n'

      return ran(0, e.argv[1] === 'status' ? clean : (GIT[e.argv[1] ?? ''] ?? ''))
    }
    if (e.argv[1] === 'auth') return ran(0, '')
    const path = e.argv[3] ?? ''
    const body = /\/repos\/acme\/app$/.test(path) ? { open_issues_count: 3 } : /search/.test(path) ? { total_count: 0, items: [] } : []

    return ran(0, `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(body)}`)
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const text of [/^ ✓ CLEAN $/, /^⎇ feature\/x → origin\/feature\/x$/, /^3 issues$/, /^0 PRs$/]) {
    expect(await band.find({ type: 'Text', text })).toBeDefined()
  }
  // one line: no second line with the branch again
  expect((await band.findAll({ type: 'Text', text: /^⎇ feature\/x → / })).length).toBe(1)
  await band.unmount()
})
