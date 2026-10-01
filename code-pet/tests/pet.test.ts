import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { BUSY_LOAD, FRANTIC_LOAD, SLEEPY_AFTER_MS, draw, moodFor, pickIdle } from '../hooks/pet'
import { H, ROWS, W, paint, quadrant, toCells } from '../hooks/pixels'

const BAND = {
  plugin: 'code-pet',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as unknown as RenderPropsOf['AbovePrompt'],
} as const

describe('mood', () => {
  const base = { isWorking: false, load: 0, event: null, idle: 'play', now: 100_000 } as const

  test('idle pet does its idle activity', () => {
    expect(moodFor(base)).toBe('play')
    expect(moodFor({ ...base, idle: 'purr' })).toBe('purr')
  })

  test('workload drives watch, busy and frantic', () => {
    expect(moodFor({ ...base, isWorking: true })).toBe('watch')
    expect(moodFor({ ...base, isWorking: true, load: BUSY_LOAD })).toBe('busy')
    expect(moodFor({ ...base, isWorking: true, load: FRANTIC_LOAD })).toBe('frantic')
  })

  test('reactions win briefly, then fade', () => {
    const event = { kind: 'startled', at: 99_000 } as const
    expect(moodFor({ ...base, isWorking: true, load: 20, event })).toBe('startled')
    expect(moodFor({ ...base, event, now: 120_000 })).toBe('play')
  })

  test('long quiet stretches make naps the likeliest idle activity', () => {
    const naps = Array.from({ length: 100 }, (_, i) => pickIdle(SLEEPY_AFTER_MS + 1, i / 100)).filter(a => a === 'sleep')
    expect(naps.length).toBeGreaterThan(50)
    expect(pickIdle(0, 0.5, 'play')).not.toBe('play')
  })

  test('the ball moves while playing', () => {
    const balls = [0, 1, 2, 3].map(f => draw('cat', 'play', f, 'Mochi').lines[3])
    expect(new Set(balls).size).toBe(4)
    expect(draw('dog', 'play', 0, 'Rex').caption).toContain('Rex')
    expect(draw('pikachu', 'play', 0, 'Pika').caption).toContain('Poké Ball')
  })
})

describe('band', () => {
  test('shows the pet and reacts to heavy tool use', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 })
    mock.store(on, { config: { species: 'dog', name: 'Rex', isHidden: false } })
    on('command.register', () => ({ value: { command: 'pet' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await clock.advance(600)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: /Rex/ })).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toEqual(surface === 'terminal' ? expect.anything() : undefined)
      await ui.unmount()
    }

    for (let i = 0; i < FRANTIC_LOAD; i++) {
      await $.tool.call({ tool: 'Read', file_path: '/tmp/x' })
    }
    await clock.advance(600)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: true } } as typeof BAND & { surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /zooming/ })).toBeDefined()
    await ui.unmount()
  })

  test('/pet switches species and hides', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('command.register', () => ({ value: { command: 'pet' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine band') as never
    })

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const run = (args: string) => $.command.run({ command: 'pet', args } as Parameters<typeof $.command.run>[0])

    expect((await run('dog')).text).toContain('dog')
    expect((await run('name Biscuit')).text).toContain('Biscuit')
    expect((await run('pickahu')).text).toContain('pikachu')

    await run('hide')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /Biscuit/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('pixels', () => {
  test('every species and mood packs into a full raster', () => {
    const moods = ['sit', 'sleep', 'purr', 'groom', 'play', 'watch', 'busy', 'frantic', 'startled', 'happy', 'perk'] as const
    for (const species of ['cat', 'dog', 'pikachu'] as const) {
      for (const mood of moods) {
        for (const frame of [0, 1, 7, 13]) {
          const canvas = paint(species, mood, frame)
          expect(canvas).toHaveLength(H)
          expect(toCells(canvas)).toHaveLength((W * ROWS * 12 * 4) / 3)
        }
      }
    }
  })
})

describe('quadrants', () => {
  const DEFAULT = 0x01000000

  test('two colors keep their shape, transparency stays the background', () => {
    expect(quadrant([0xff0000, null, null, 0xff0000])).toEqual([0x259a, 0xff0000, DEFAULT])
    expect(quadrant([1, 1, 2, 2])).toEqual([0x2580, 1, 2])
    expect(quadrant([null, null, null, null])).toEqual([0x20, DEFAULT, DEFAULT])
    expect(quadrant([5, 5, 5, 5])).toEqual([0x2588, 5, DEFAULT])
  })

  test('a third color joins the nearer of the two kept', () => {
    const [ch, fg, bg] = quadrant([0x000000, 0x000000, 0xffffff, 0xeeeeee])
    // white and near-white tie; the darker one is kept, the other joins it
    expect([ch, fg, bg]).toEqual([0x2580, 0x000000, 0xeeeeee])
  })
})
