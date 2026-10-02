import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import { aggregate, checkFromRun, intervalLabel, nextInterval, parseGhResponse, countFromLink, latestPerEnvironment, parsePorcelain, parseRemote, parseTestCounts, verdict } from '../hooks/parse'

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

const GITHUB: [RegExp, unknown, Record<string, string>?][] = [
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
        { name: 'unit tests', status: 'completed', conclusion: 'success', output: { title: '128 passed, 2 skipped' } },
        { name: 'e2e', status: 'in_progress', conclusion: null, output: {} },
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
    ]) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  }
  expect(asked.length).toBeGreaterThan(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /⎇ feature\/x ↑1 .*PR #12 · CI ● 1\/2 \(1 running\) · Tests 128✓ 0✗ · preview: success · 5 issues · 4 PRs/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Crash on start/ })).toBeUndefined()
    expect(await band.find({ key: 'auto' })).toBeUndefined()
    await band.press({ key: 'git-details' })
    expect(await band.find({ type: 'Text', text: /Crash on start/ })).toBeDefined()
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
