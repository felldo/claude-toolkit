import type { IdleActivity, Mood, PetEvent, Species } from '../types'

/** Tool calls in the last LOAD_WINDOW_MS that make the pet busy / frantic. */
export const LOAD_WINDOW_MS = 30_000
export const BUSY_LOAD = 4
export const FRANTIC_LOAD = 12

/** How long a one-off reaction (error, finished turn, new prompt) lasts. */
const EVENT_MS: Record<PetEvent['kind'], number> = {
  startled: 4_000,
  happy: 6_000,
  perk: 3_000,
}

/** After this long without any work the pet prefers to nap. */
export const SLEEPY_AFTER_MS = 3 * 60_000

export type MoodInput = {
  isWorking: boolean
  load: number
  event: PetEvent | null
  idle: IdleActivity
  now: number
}

export function moodFor({ isWorking, load, event, idle, now }: MoodInput): Mood {
  if (event && now - event.at < EVENT_MS[event.kind]) {
    return event.kind
  }
  if (isWorking) {
    if (load >= FRANTIC_LOAD) return 'frantic'
    if (load >= BUSY_LOAD) return 'busy'
    return 'watch'
  }
  return idle
}

/** Picks the next idle activity; long quiet stretches make naps likelier. */
export function pickIdle(idleForMs: number, roll: number, current?: IdleActivity): IdleActivity {
  const weights: [IdleActivity, number][] =
    idleForMs > SLEEPY_AFTER_MS
      ? [['sleep', 6], ['purr', 2], ['groom', 1], ['play', 1], ['sit', 1]]
      : [['play', 4], ['purr', 3], ['groom', 2], ['sit', 2], ['sleep', 1]]
  const pool = weights.filter(([a]) => a !== current)
  const total = pool.reduce((sum, [, w]) => sum + w, 0)
  let r = roll * total
  for (const [activity, w] of pool) {
    r -= w
    if (r < 0) return activity
  }
  return pool[pool.length - 1]![0]
}

/** Seconds an idle activity lasts before the pet gets bored of it. */
export function idleDurationMs(activity: IdleActivity, roll: number): number {
  const base = activity === 'sleep' ? 60_000 : 15_000
  return base + Math.floor(roll * base)
}

const WIDTH = 16
const pad = (s: string) => (s.length >= WIDTH ? s.slice(0, WIDTH) : s + ' '.repeat(WIDTH - s.length))
const at = <T,>(list: readonly T[], frame: number): T => list[frame % list.length]!

/** Ball bouncing back and forth across `span` cells. */
function ballLine(frame: number, span = 9, ball = 'o'): string {
  const period = span * 2 - 2
  const step = frame % period
  const x = step < span ? step : period - step
  return ' '.repeat(x) + ball
}

type Art = { lines: string[]; caption: string }

function cat(mood: Mood, frame: number, name: string): Art {
  const blink = frame % 8 === 7
  const eyes = blink ? '-.-' : 'o.o'
  switch (mood) {
    case 'sit':
      return { lines: [' /\\_/\\', `( ${eyes} )`, ' > ^ <', ''], caption: `${name} is sitting pretty` }
    case 'sleep':
      return {
        lines: [at(['        z', '       zZ', '      zZz', '     Z'], frame), ' /\\_/\\', '( -.- )', ' c(")(")'],
        caption: `${name} is napping`,
      }
    case 'purr':
      return {
        lines: [' /\\_/\\', '( ^.^ )' + at(['  ~', ' ~ ', '~  '], frame), ' (")(")', at(['  purr~', '   purr~~', '  ~purr'], frame)],
        caption: `${name} is purring`,
      }
    case 'groom':
      return {
        lines: [' /\\_/\\', at(['( ^.- )', '( -.^ )~', '( ^.- )~', '( -.- )'], frame), at([' > ^ <_/', ' > ^ <', ' > ^ <_/'], frame), ''],
        caption: `${name} is grooming`,
      }
    case 'play': {
      const step = frame % 16
      const looking = step < 8 ? '( o.o)' : '(o.o )'
      return {
        lines: [' /\\_/\\', looking, at([' > ^ <_/', ' > ^ < '], frame), ballLine(frame, 9, 'o')],
        caption: `${name} is batting a ball around`,
      }
    }
    case 'watch':
      return {
        lines: [' /\\_/\\', at(['( o.o )', '(o.o  )', '( o.o )', '(  o.o)'], Math.floor(frame / 2)), ' > ^ <', ''],
        caption: `${name} is watching Claude work`,
      }
    case 'busy':
      return {
        lines: [' /\\_/\\  ≡', '( •.• ) ≡', at([' /|  |\\', ' \\|  |/'], frame), ''],
        caption: `${name} is running alongside`,
      }
    case 'frantic':
      return {
        lines: [at([" /\\_/\\ '", " /\\_/\\'"], frame), '( O.O ) !!', at([' /|  |\\ ≡≡', ' \\|  |/≡≡'], frame), ''],
        caption: `${name} can barely keep up!`,
      }
    case 'startled':
      return { lines: [' /\\!/\\', '( O_O )', ' >^^^<', ''], caption: `${name} got spooked by an error` }
    case 'happy':
      return {
        lines: [at([' /\\_/\\  *', ' /\\_/\\ * '], frame), '( ^w^ )', ' > ^ <', ''],
        caption: `${name} is happy it's done`,
      }
    case 'perk':
      return { lines: [' /\\_/\\ ?', '( o.o )', ' > ^ <', ''], caption: `${name}'s ears perk up` }
  }
}

function dog(mood: Mood, frame: number, name: string): Art {
  const blink = frame % 9 === 8
  const eyes = blink ? '- -' : 'o o'
  const wag = at([')', '/', ')', '\\'], frame)
  switch (mood) {
    case 'sit':
      return { lines: ['  /^-^\\', ` / ${eyes} \\`, ` V\\ Y /V ${wag}`, ''], caption: `${name} is sitting nicely` }
    case 'sleep':
      return {
        lines: [at(['         z', '        zZ', '       zZz', '      Z'], frame), '  /^-^\\', ' / - - \\', ' V\\_Y_/V'],
        caption: `${name} is snoozing`,
      }
    case 'purr':
      return {
        lines: ['  /^-^\\', ' / ^ ^ \\', ` V\\ U /V ${at(['~)', '~/', '~\\'], frame)}`, at(['  wag wag', '   wag wag!', '  wag'], frame)],
        caption: `${name} is wagging happily`,
      }
    case 'groom':
      return {
        lines: ['  /^-^\\', ` / ${eyes} \\`, at([' V\\ Y /V=o=', ' V\\ U /V=o=', ' V\\ Y /V o='], frame), ''],
        caption: `${name} is chewing a bone`,
      }
    case 'play': {
      const step = frame % 16
      return {
        lines: ['  /^-^\\', step < 8 ? ' /  o o\\' : ' / o o  \\', ` V\\ U /V ${wag}`, ballLine(frame, 10, 'o')],
        caption: `${name} is chasing the ball`,
      }
    }
    case 'watch':
      return {
        lines: ['  /^-^\\', at([' / o o \\', ' /o o  \\', ' / o o \\', ' /  o o\\'], Math.floor(frame / 2)), ' V\\ Y /V', ''],
        caption: `${name} is watching Claude work`,
      }
    case 'busy':
      return {
        lines: ['  /^-^\\  ≡', ' / • • \\ ≡', at([' V\\ U /V /|', ' V\\ U /V |\\'], frame), ''],
        caption: `${name} is fetching files`,
      }
    case 'frantic':
      return {
        lines: [at(["  /^-^\\ '", "  /^-^\\'"], frame), ' / O O \\ !!', at([' V\\ O /V ≡≡', ' V\\ o /V≡≡'], frame), ''],
        caption: `${name} is zooming around!`,
      }
    case 'startled':
      return { lines: ['  /^!^\\', ' / O O \\', ' V\\ o /V', ''], caption: `${name} barks at an error` }
    case 'happy':
      return {
        lines: [at(['  /^-^\\  *', '  /^-^\\ * '], frame), ' / ^ ^ \\', ` V\\ U /V ${wag}${wag}`, ''],
        caption: `${name} is proud of the work`,
      }
    case 'perk':
      return { lines: ['  /^-^\\ ?', ' / o o \\', ' V\\ Y /V', ''], caption: `${name} tilts its head` }
  }
}

function pikachu(mood: Mood, frame: number, name: string): Art {
  const blink = frame % 8 === 7
  const eyes = blink ? '-.-' : 'o.o'
  const ears = ' \\\\     //'
  const tail = at(['ϟ', ' ϟ'], Math.floor(frame / 2))
  switch (mood) {
    case 'sit':
      return { lines: [ears, `( @${eyes}@ )`, ` (")_(")${tail}`, ''], caption: `${name} is sitting on your shoulder` }
    case 'sleep':
      return {
        lines: [at(['          z', '         zZ', '        zZz', '       Z'], frame), ears, '( @-.-@ )', ' (")_(")ϟ'],
        caption: `${name} is napping`,
      }
    case 'purr':
      return {
        lines: [ears, '( @^.^@ )', ` (")_(")${tail}`, at(['  pika~', '   pika pika~', '  pikaa~'], frame)],
        caption: `${name} is cooing happily`,
      }
    case 'groom':
      return {
        lines: [ears, at(['( @o.o@ )', '(*@o.o@*)', '(*~o.o~*)', '( @o.o@ )'], frame), ` (")_(")${tail}`, ''],
        caption: `${name} is charging its cheeks`,
      }
    case 'play': {
      const step = frame % 16
      return {
        lines: [ears, step < 8 ? '( @ o.o@)' : '(@o.o @ )', at([' (")_(")ϟ', ' (")_(")_/'], frame), ballLine(frame, 10, 'o')],
        caption: `${name} is playing with a Poké Ball`,
      }
    }
    case 'watch':
      return {
        lines: [ears, at(['( @o.o@ )', '( @o.o @)', '( @o.o@ )', '(@ o.o@ )'], Math.floor(frame / 2)), ` (")_(")${tail}`, ''],
        caption: `${name} is watching Claude work`,
      }
    case 'busy':
      return {
        lines: [ears + ' ≡', '( @•.•@ ) ≡', at([' /|  |\\ ϟ', ' \\|  |/ϟ'], frame), ''],
        caption: `${name} is using Quick Attack`,
      }
    case 'frantic':
      return {
        lines: [at([ears + " '", ears + "'"], frame), '(*@O.O@*)ϟϟ', at([' /|  |\\ ϟϟϟ', ' \\|  |/ϟϟϟ'], frame), ''],
        caption: `${name} is crackling with electricity!`,
      }
    case 'startled':
      return { lines: [ears + ' !', '(*@O_O@*)', ' (")_(")ϟ', at(['  bzzt!', ' ~bzzt~'], frame)], caption: `${name} zaps an error` }
    case 'happy':
      return {
        lines: [at([ears + '  *', ears + ' * '], frame), '( @^w^@ )', ` (")_(")${tail}`, '  pika!'],
        caption: `${name} is proud of the work`,
      }
    case 'perk':
      return { lines: [ears + ' ?', '( @o.o@ )', ' (")_(")ϟ', ''], caption: `${name} says "pika?"` }
  }
}

export function draw(species: Species, mood: Mood, frame: number, name: string): Art {
  const art =
    species === 'dog' ? dog(mood, frame, name) : species === 'pikachu' ? pikachu(mood, frame, name) : cat(mood, frame, name)
  return { lines: art.lines.map(pad), caption: art.caption }
}

export const MOOD_COLOR: Record<Mood, string | undefined> = {
  sit: undefined,
  sleep: 'blue',
  purr: 'magenta',
  groom: undefined,
  play: 'green',
  watch: 'cyan',
  busy: 'yellow',
  frantic: 'red',
  startled: 'red',
  happy: 'green',
  perk: 'cyan',
}
