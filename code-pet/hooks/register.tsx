import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PetConfig, PetEvent, PetIdle, PetTick, Species } from '../types'
import { LOAD_WINDOW_MS, MOOD_COLOR, draw, idleDurationMs, moodFor, pickIdle } from './pet'

const FRAME_MS = 500
const STORE_KEY = 'config'
const DEFAULT_CONFIG: PetConfig = { species: 'cat', name: 'Mochi', isHidden: false }

const tick = atom({ plugin: 'code-pet', key: 'tick' } as const, { frame: 0, now: 0, load: 0 } as PetTick)
const event = atom({ plugin: 'code-pet', key: 'event' } as const, null as PetEvent | null)
const idle = atom({ plugin: 'code-pet', key: 'idle' } as const, { activity: 'sit', until: 0 } as PetIdle)
const config = atom({ plugin: 'code-pet', key: 'config' } as const, DEFAULT_CONFIG)

const SPECIES_ALIASES: Record<string, string> = { pika: 'pikachu', pickachu: 'pikachu', pickahu: 'pikachu', pikachu: 'pikachu' }

const HELP = [
  '/pet                      show what your pet is up to',
  '/pet cat | dog | pikachu  switch species',
  '/pet name <name>          rename your pet',
  '/pet hide | show          hide or show the pet',
].join('\n')

async function react($: EngineInterface, kind: PetEvent['kind']) {
  const now = await $.clock.now()
  await update($, event, () => ({ kind, at: now }))
}

async function saveConfig($: EngineInterface, fn: (c: PetConfig) => PetConfig) {
  const saved = await update($, config, fn)
  await $.store.set(STORE_KEY, saved)
  return saved
}

export const register: Register = on => {
  // Timestamps of recent tool calls; a reload just resets the workload meter.
  let toolCalls: number[] = []
  let lastWorkAt = 0

  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get(STORE_KEY)) as Partial<PetConfig> | undefined
    await update($, config, () => ({ ...DEFAULT_CONFIG, ...stored }))
    lastWorkAt = await $.clock.now()

    await $.command.register({
      name: 'pet',
      description: 'Your pet: /pet [cat|dog|pikachu|name <name>|hide|show]',
    })

    $.clock.every(FRAME_MS, async () => {
      const cfg = await read($, config)
      if (cfg.isHidden) return

      const now = await $.clock.now()
      toolCalls = toolCalls.filter(t => now - t < LOAD_WINDOW_MS)

      const current = await read($, idle)
      if (now >= current.until) {
        const activity = pickIdle(now - lastWorkAt, Math.random(), current.activity)
        await update($, idle, () => ({ activity, until: now + idleDurationMs(activity, Math.random()) }))
      }

      await update($, tick, t => ({ frame: t.frame + 1, now, load: toolCalls.length }))
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await react($, 'perk')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    toolCalls.push(now)
    lastWorkAt = now

    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      await react($, 'startled')
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    lastWorkAt = await $.clock.now()
    await react($, 'happy')
    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const word = SPECIES_ALIASES[verb.toLowerCase()] ?? verb.toLowerCase()

    if (word === 'cat' || word === 'dog' || word === 'pikachu') {
      const cfg = await saveConfig($, c => ({ ...c, species: word as Species, isHidden: false }))
      return { text: `${cfg.name} is now a ${cfg.species}.` }
    }
    if (word === 'name') {
      const name = rest.join(' ').trim().slice(0, 24)
      if (!name) return { text: 'Usage: /pet name <name>' }
      await saveConfig($, c => ({ ...c, name }))
      return { text: `Your pet is now called ${name}.` }
    }
    if (word === 'hide' || word === 'show') {
      const cfg = await saveConfig($, c => ({ ...c, isHidden: word === 'hide' }))
      return { text: word === 'hide' ? `${cfg.name} curls up out of sight.` : `${cfg.name} is back!` }
    }
    if (word === 'help') {
      return { text: HELP }
    }

    const cfg = await read($, config)
    const t = await read($, tick)
    const mood = moodFor({
      isWorking: false,
      load: t.load,
      event: await read($, event),
      idle: (await read($, idle)).activity,
      now: t.now,
    })
    return { text: `${draw(cfg.species, mood, t.frame, cfg.name).caption}.\n\n${HELP}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = await read($, config)
    if (e.props.hasSurvey || cfg.isHidden) {
      return next(e)
    }

    const t = await read($, tick)
    const mood = moodFor({
      isWorking: e.props.isWorking,
      load: t.load,
      event: await read($, event),
      idle: (await read($, idle)).activity,
      now: t.now,
    })
    const art = draw(cfg.species, mood, t.frame, cfg.name)
    const color = MOOD_COLOR[mood] ?? (cfg.species === 'pikachu' ? 'yellow' : undefined)
    const meter = '▮'.repeat(Math.min(t.load, 12)) + '▯'.repeat(Math.max(0, 12 - t.load))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Box flexDirection="column">
          {art.lines.map(line => (
            <Text color={color}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>{art.caption}</Text>
          <Text dimColor>
            workload {meter} {t.load} tools/30s
          </Text>
        </Box>
      </Box>
    )
  })
}
