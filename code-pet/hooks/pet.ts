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

function mew(mood: Mood, frame: number, name: string): Art {
  const blink = frame % 8 === 7
  const eyes = blink ? '-.-' : 'O.O'
  const ears = ' ^     ^'
  const tail = at(['~~', ' ~~', '~ ~'], frame)
  // Mew hovers: an empty line above or below the body.
  const hover = (lines: string[]) => (Math.floor(frame / 2) % 2 ? lines : ['', ...lines].slice(0, 4))
  switch (mood) {
    case 'sit':
      return { lines: hover([ears, `( ${eyes} )`, ` (u u)${tail}`, '']), caption: `${name} is hovering about` }
    case 'sleep':
      return {
        lines: [at(['          z', '         zZ', '        zZz', '       Z'], frame), ears, '( -.- )', ' (u u)~'],
        caption: `${name} is floating asleep`,
      }
    case 'purr':
      return {
        lines: hover([ears, '( ^.^ )', ` (u u)${tail}`, at(['  mew~', '   mew mew~', '  mewww~'], frame)]),
        caption: `${name} is humming happily`,
      }
    case 'groom':
      return {
        lines: hover([ears + at([' *', '  *', ' * '], frame), `( ${eyes} )`, ` (u u)${tail}`, at(['   * .', '  . *', ' *  .'], frame)]),
        caption: `${name} is doing psychic tricks`,
      }
    case 'play': {
      const step = frame % 16
      return {
        lines: hover([ears, step < 8 ? '(  O.O)' : '(O.O  )', ` (u u)${tail}`, ballLine(frame, 10, 'o')]),
        caption: `${name} is batting a bubble`,
      }
    }
    case 'watch':
      return {
        lines: hover([ears, at(['( O.O )', '(O.O  )', '( O.O )', '(  O.O)'], Math.floor(frame / 2)), ` (u u)${tail}`, '']),
        caption: `${name} is watching Claude work`,
      }
    case 'busy':
      return {
        lines: [ears + '  ≡', '( •.• ) ≡', at([' (u u)~ *', ' (u u)~*'], frame), ''],
        caption: `${name} is teleporting between files`,
      }
    case 'frantic':
      return {
        lines: [at([ears + " '", ears + "'"], frame), '(*O.O*) !!', at([' (u u)~ ***', ' (u u)~***'], frame), ''],
        caption: `${name} is glowing with psychic power!`,
      }
    case 'startled':
      return { lines: [ears + ' !', '( O_O )', ' (u u)~', at(['  *mew!*', ' * mew! *'], frame)], caption: `${name} mews at an error` }
    case 'happy':
      return {
        lines: hover([at([ears + '  *', ears + ' * '], frame), '( ^w^ )', ` (u u)${tail}`, '  mew!']),
        caption: `${name} is proud of the work`,
      }
    case 'perk':
      return { lines: [ears + ' ?', '( O.O )', ' (u u)~', ''], caption: `${name} says "mew?"` }
  }
}

type Template = {
  /** The pet's four lines; `$e` is replaced by the eyes. */
  lines: [string, string, string, string]
  captions: Record<Mood, string>
  sleepy?: boolean
}

const EYES_FOR: Record<Mood, string> = {
  sit: 'o o', sleep: '- -', purr: '^ ^', groom: '- -', play: 'o o', watch: 'o o',
  busy: '• •', frantic: 'O O', startled: 'O O', happy: '^ ^', perk: 'o o',
}

const EXTRAS: Partial<Record<Mood, readonly string[]>> = {
  sleep: ['  z', ' zZ', 'zZz'],
  purr: [' ♪', '  ♪', ' ♪ ♪'],
  busy: [' ≡', '≡'],
  frantic: [" '!!", "'!!"],
  startled: [' !'],
  happy: ['  *', ' * '],
  perk: [' ?'],
}

/** Text art for the pets that only differ in shape and words. */
function templated(t: Template) {
  return (mood: Mood, frame: number, name: string): Art => {
    let eyes = EYES_FOR[mood]
    if (t.sleepy && (eyes === 'o o' || eyes === '• •')) eyes = '- -'
    if (frame % 8 === 7 && eyes === 'o o') eyes = '- -'
    const lines = t.lines.map(line => line.replace('$e', eyes))
    const extra = EXTRAS[mood]
    if (extra) lines[0] += at(extra, frame)
    if (mood === 'play') lines[3] += ' ' + ballLine(frame, 8, 'o')
    return { lines, caption: `${name} ${t.captions[mood]}` }
  }
}

const snorlax = templated({
  lines: ['  ^_____^', ' ( $e  )', ' (  ___  )', '  (_____)'],
  sleepy: true,
  captions: {
    sit: 'is lounging', sleep: 'is snoring loudly', purr: 'is munching a snack', groom: 'is scratching its belly',
    play: 'is juggling an apple', watch: 'is watching Claude work (barely)', busy: 'is lumbering along',
    frantic: 'is actually awake?!', startled: 'jolts awake at an error', happy: 'pats its belly contentedly',
    perk: 'opens one eye',
  },
})

const jigglypuff = templated({
  lines: ['  /\\ @ /\\', ' ( $e )', ' (   o   )', '   "   "'],
  captions: {
    sit: 'is puffing up', sleep: 'is napping', purr: 'is singing a lullaby', groom: 'is fluffing its curl',
    play: 'is twirling its microphone', watch: 'is watching Claude work', busy: 'is rolling along',
    frantic: 'is puffed up with stress!', startled: 'puffs up at an error', happy: 'is singing a victory song',
    perk: 'says "jiggly?"',
  },
})

const togepi = templated({
  lines: ['   ^^^^^', '  ( $e )', ' /VVVVVVV\\', ' \\_______/'],
  captions: {
    sit: 'is wobbling in its shell', sleep: 'is curled up in its shell', purr: 'is chirping "toge-toge"',
    groom: 'is polishing its shell', play: 'is chasing a star', watch: 'is watching Claude work',
    busy: 'is waddling fast', frantic: 'is wobbling wildly!', startled: 'hides in its shell',
    happy: 'is spreading good luck', perk: 'says "toge?"',
  },
})

const shiba = templated({
  lines: ['  /\\_/\\', ' ( $e )', ' (  ω  )@', '  U   U'],
  captions: {
    sit: 'sits proudly', sleep: 'is curled up napping', purr: 'is doing a happy wiggle', groom: 'is chewing a toy',
    play: 'is chasing its red ball', watch: 'is side-eyeing the code', busy: 'has the zoomies',
    frantic: 'is doing the shiba scream!', startled: 'screams at an error', happy: 'is smiling its shiba smile',
    perk: 'tilts its head',
  },
})

const raccoon = templated({
  lines: ['  /\\_/\\', ' (=$e=)', ' ( ^ ^ )', '  U   U~='],
  captions: {
    sit: 'is sitting on the trash can', sleep: 'is napping in a hollow log', purr: 'is chittering happily',
    groom: 'is washing its snack', play: 'is playing with a shiny coin',
    watch: 'is watching Claude work from the shadows', busy: 'is rummaging through files',
    frantic: 'is raiding everything at once!', startled: 'hisses at an error', happy: 'found treasure',
    perk: 'peeks out curiously',
  },
})

const pengu = templated({
  lines: ['   .---.', '  ( $e )', ' /(  v  )\\', '   ^   ^'],
  captions: {
    sit: 'is vibing', sleep: 'is napping on an ice floe', purr: 'is doing a happy flap', groom: 'is preening its feathers',
    play: 'is chasing a fish', watch: 'is watching Claude work', busy: 'is waddling at full speed',
    frantic: 'is flapping frantically!', startled: 'slips on an error', happy: 'does a little dance',
    perk: 'tilts its head',
  },
})

const ARTISTS: Record<Species, (mood: Mood, frame: number, name: string) => Art> = {
  cat,
  dog,
  pikachu,
  mew,
  snorlax,
  jigglypuff,
  togepi,
  shiba,
  raccoon,
  pengu,
}

/** Every species, with the words `/pet` takes for it (German names too). */
export const SPECIES_WORDS: Record<string, Species> = {
  cat: 'cat', katze: 'cat',
  dog: 'dog', hund: 'dog',
  pikachu: 'pikachu', pika: 'pikachu', pickachu: 'pikachu', pickahu: 'pikachu',
  mew: 'mew',
  snorlax: 'snorlax', relaxo: 'snorlax',
  jigglypuff: 'jigglypuff', pummeluff: 'jigglypuff', pummeluf: 'jigglypuff',
  togepi: 'togepi',
  shiba: 'shiba', 'shiba-inu': 'shiba', shibainu: 'shiba',
  raccoon: 'raccoon', waschbär: 'raccoon', waschbaer: 'raccoon',
  pengu: 'pengu', penguin: 'pengu', pinguin: 'pengu',
}

export function draw(species: Species, mood: Mood, frame: number, name: string): Art {
  const art = ARTISTS[species](mood, frame, name)
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
