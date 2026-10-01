import type { Mood, Species } from '../types'

/**
 * Pixel-art pets for the terminal: a canvas of PX_W x H pixels drawn into a
 * Raster of W columns and ROWS rows, each cell a quadrant block (2 x 2 pixels)
 * holding at most two colors. A pixel is half a cell wide and half a cell
 * tall, so sprites are drawn here with the proportions of monospace text.
 */
export const W = 40
export const ROWS = 10
export const PX_W = W * 2
export const H = ROWS * 2

const DEFAULT = 0x01000000

const PALETTE: Record<string, number> = {
  K: 0x2b2b2b, // outline
  W: 0xffffff,
  O: 0xf0a040, // cat fur
  D: 0xc06820, // cat stripes
  P: 0xff9ab0, // pink
  B: 0x9a6234, // dog fur
  L: 0xe8c9a0, // dog muzzle
  N: 0x5a3a20, // dog ears
  Y: 0xffd833, // pikachu
  b: 0xa0522d, // pikachu tail base
  R: 0xe03c31, // red
  G: 0x8a8a8a, // speed lines
  C: 0x7fc8ff, // sweat, z
  H: 0xff5c8a, // hearts
  S: 0xfff3a0, // sparkles
  g: 0xb5e04a, // tennis ball
}

type Sprite = readonly string[]

/** A symmetric sprite from its left half; the last column is the centre. */
const mirror = (half: Sprite): Sprite => half.map(row => row + [...row.slice(0, -1)].reverse().join(''))

/** Doubles every pixel across, for stamps drawn at the coarse scale. */
const widen = (sprite: Sprite): Sprite => sprite.map(row => row.replace(/./g, ch => ch + ch))

type Body = {
  sprite: Sprite
  eyes: readonly [number, number][]
  tail: readonly Sprite[]
  tailAt: [number, number]
  ball: Sprite
}

// Each body is 29 pixels wide (a mirrored half of 15) and 18 tall.
const BODIES: Record<Species, Body> = {
  cat: {
    sprite: mirror([
      '..KK...........',
      '..KPK..........',
      '..KPPK.........',
      '..KOPPKKKKKKKKK',
      '.KOOOOOOOOODODO',
      '.KOOOOOOOOOODOD',
      'KOOOOOOOOOOOOOO',
      'KOOOOOOOOOOOOOO',
      'KOOOOOOOOOOOOOO',
      'KWWOOOOOOOOOOPP',
      '.KWWOOOOOOOOKKO',
      '..KKWWOOOOOOOOO',
      '...KOOOOOWWWWWW',
      '..KOOOOOWWWWWWW',
      '..KOOOOOWWWWWWW',
      '..KOOOOOWWWWWWW',
      '..KOOWWKWWWWWWK',
      '..KKKKKKKKKKKKK',
    ]),
    eyes: [[5, 7], [20, 7]],
    tail: [
      ['....KK', '...KOK', '...KOK', '..KOK.', 'KKOK..', 'OOK...', 'KK....'],
      ['......', '..KK..', '.KOOK.', '..KOK.', 'KKOK..', 'OOK...', 'KK....'],
    ],
    tailAt: [27, 11],
    ball: widen(['.H.', 'HHH', '.H.']),
  },
  dog: {
    sprite: mirror([
      '...............',
      '......KKKKKKKKK',
      '....KKBBBBBBBBB',
      '..KKNNKBBBBBBBB',
      '.KNNNNKBBBBBBBB',
      'KNNNNNKBBBBBBBB',
      'KNNNNNKBBBBBBBB',
      'KNNNNNKBBBBBBBB',
      'KNNNNNKBBBBBBBB',
      'KNNNNKBBBBLLLLL',
      '.KNNKBBBBLLLKKK',
      '..KKKKKLLLLLLKL',
      '......KKLLLLLPP',
      '.....KBBKKKKKPP',
      '....KBBBBBBLLLL',
      '....KBBBBBBLLLL',
      '....KBBKBBBLLLL',
      '....KKKKKKKKKKK',
    ]),
    eyes: [[8, 7], [17, 7]],
    tail: [
      ['..KK', '.KBK', 'KBK.', 'KK..'],
      ['KK..', 'KBK.', '.KBK', '..KK'],
    ],
    tailAt: [25, 11],
    ball: widen(['.g.', 'ggg', '.g.']),
  },
  pikachu: {
    sprite: mirror([
      'KK.............',
      'KKK............',
      '.KKY...........',
      '..KYY..........',
      '...KYYKKKKKKKKK',
      '...KYYYYYYYYYYY',
      '..KYYYYYYYYYYYY',
      '.KYYYYYYYYYYYYY',
      '.KYYYYYYYYYYYYK',
      'KRRRYYYYYYYYYYY',
      'KRRRYYYYYYYYKYK',
      '.KYYYYYYYYYYYKY',
      '..KKYYYYYYYYYYY',
      '...KYYYYYYYYYYY',
      '..KYYYYYYYYYYYY',
      '..KYYYYYYYYYYYY',
      '..KYYKYYYYYYYYY',
      '...KKKKKKKKKKKK',
    ]),
    eyes: [[5, 7], [20, 7]],
    tail: [
      ['......YYY', '.....YYYY', '....YYYY.', '...YYYY..', '..YYYYYY.', '....YYY..', '...YYY...', '..bYY....', '.bb......'],
      ['.......YY', '.....YYYY', '....YYYY.', '...YYYY..', '..YYYYYY.', '....YYY..', '...YYY...', '..bYY....', '.bb......'],
    ],
    tailAt: [27, 6],
    ball: widen(['.RR.', 'KKKK', 'WWWW', '.WW.']),
  },
}

// 4 x 2 eye expressions; '.' keeps the fur.
const EYES = {
  open: ['KWKK', 'KKKK'],
  right: ['KKWK', 'KKKK'],
  closed: ['....', 'KKKK'],
  happy: ['.KK.', 'K..K'],
  wide: ['WWWW', 'WKKW'],
} as const satisfies Record<string, Sprite>

const STAMPS = {
  z: ['CCCCC', '...C.', '..C..', '.C...', 'CCCCC'],
  bigZ: ['CCCCCCCC', '.....CC.', '...CC...', '.CC.....', 'CCCCCCCC'],
  heart: widen(['.H.H.', 'HHHHH', '.HHH.', '..H..']),
  sparkle: widen(['.S.', 'SSS', '.S.']),
  bolt: widen(['..YY', '.YY.', 'YYYY', '.YY.', 'YY..']),
  bang: widen(['R', 'R', 'R', '.', 'R']),
  question: widen(['WWW', '..W', '.W.', '...', '.W.']),
  sweat: widen(['.C', 'CC', 'CC']),
  bone: widen(['W....W', 'WWWWWW', 'W....W']),
  sparks: ['S.S', '.S.', 'S.S'],
} as const satisfies Record<string, Sprite>

type Canvas = (number | null)[][]

function stamp(canvas: Canvas, sprite: Sprite, x: number, y: number) {
  sprite.forEach((row, dy) => {
    const line = canvas[y + dy]
    if (!line) return
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!
      if (ch === '.' || x + dx < 0 || x + dx >= PX_W) continue
      line[x + dx] = PALETTE[ch] ?? null
    }
  })
}

function eyeStyle(mood: Mood, frame: number): Sprite {
  switch (mood) {
    case 'sleep':
      return EYES.closed
    case 'purr':
    case 'happy':
      return EYES.happy
    case 'groom':
      return frame % 4 < 2 ? EYES.closed : EYES.happy
    case 'frantic':
    case 'startled':
    case 'perk':
      return EYES.wide
    case 'watch':
      return Math.floor(frame / 3) % 2 ? EYES.right : EYES.open
    case 'play':
      return frame % 16 < 8 ? EYES.right : EYES.open
    default:
      return frame % 8 === 7 ? EYES.closed : EYES.open
  }
}

/** Where the ball is while playing: rolling right and back, bouncing. */
function ballAt(frame: number): [number, number] {
  const span = 14
  const step = frame % (span * 2)
  const x = 44 + 2 * (step < span ? step : span * 2 - step)
  const y = H - 4 - (step % 4 === 1 || step % 4 === 2 ? 2 : 0)
  return [x, y]
}

/** The pet's pixels for this mood and animation frame, as rows of colors. */
export function paint(species: Species, mood: Mood, frame: number): Canvas {
  const canvas: Canvas = Array.from({ length: H }, () => Array<number | null>(PX_W).fill(null))
  const body = BODIES[species]

  let bob = 0
  if (mood === 'busy' || mood === 'frantic') bob = frame % 2
  else if (mood === 'sleep') bob = Math.floor(frame / 4) % 2
  else if (mood === 'startled' || mood === 'happy') bob = frame % 2 ? 0 : -1
  else if (mood === 'play') bob = ballAt(frame)[0] < 50 ? -1 : 0

  const px = 8
  const py = 1 + bob
  const wags = mood !== 'sleep' && mood !== 'sit'
  const tail = body.tail[wags ? frame % body.tail.length : 0]!
  stamp(canvas, tail, px + body.tailAt[0], py + body.tailAt[1])
  stamp(canvas, body.sprite, px, py)
  const eyes = eyeStyle(mood, frame)
  for (const [ex, ey] of body.eyes) stamp(canvas, eyes, px + ex, py + ey)

  const rise = (offset: number) => 10 - ((frame + offset) % 10)
  switch (mood) {
    case 'sleep':
      stamp(canvas, STAMPS.z, 46, rise(0))
      stamp(canvas, STAMPS.bigZ, 56, rise(5) - 2)
      break
    case 'purr':
      stamp(canvas, STAMPS.heart, 46, rise(0))
      stamp(canvas, STAMPS.heart, 60, rise(5))
      break
    case 'groom':
      if (species === 'dog') stamp(canvas, STAMPS.bone, 44, 14)
      else if (species === 'pikachu') {
        stamp(canvas, STAMPS.sparks, px - 3 + (frame % 2), py + 9)
        stamp(canvas, STAMPS.sparks, px + 29 - (frame % 2), py + 9)
      } else stamp(canvas, STAMPS.heart, 46, rise(0))
      break
    case 'play': {
      const [bx, by] = ballAt(frame)
      stamp(canvas, body.ball, bx, by)
      break
    }
    case 'busy':
    case 'frantic':
      for (const y of [5, 10, 15]) stamp(canvas, [frame % 2 ? 'GGGGG' : '.GGGG'], 0, y + (frame % 2))
      if (mood === 'frantic') {
        stamp(canvas, STAMPS.sweat, 40, py + 1)
        stamp(canvas, species === 'pikachu' ? STAMPS.bolt : STAMPS.bang, 48, 2 + (frame % 2))
        if (species === 'pikachu') stamp(canvas, STAMPS.bolt, 60, 6 - (frame % 2))
      } else if (species === 'pikachu' && frame % 4 === 0) {
        stamp(canvas, STAMPS.bolt, 46, 4)
      }
      break
    case 'startled':
      stamp(canvas, species === 'pikachu' ? STAMPS.bolt : STAMPS.bang, 46, 2)
      if (species === 'pikachu') stamp(canvas, STAMPS.bolt, 58, 5)
      break
    case 'happy':
      stamp(canvas, STAMPS.sparkle, frame % 2 ? 44 : 48, 2)
      stamp(canvas, STAMPS.sparkle, frame % 2 ? 60 : 56, 8)
      stamp(canvas, STAMPS.sparkle, 0, frame % 2 ? 3 : 5)
      break
    case 'perk':
      stamp(canvas, STAMPS.question, 44, 1)
      break
  }
  return canvas
}

// Quadrant glyph per mask of set pixels: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
const QUADRANTS = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]

function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255)
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255)
  const db = (a & 255) - (b & 255)
  return dr * dr + dg * dg + db * db
}

/** One cell's glyph and colors from its four pixels, reduced to two colors. */
export function quadrant(pixels: readonly (number | null)[]): [number, number, number] {
  const counts = new Map<number | null, number>()
  for (const p of pixels) counts.set(p, (counts.get(p) ?? 0) + 1)
  // Most frequent first; on a tie a color beats transparency and darker beats lighter,
  // so outlines survive.
  const ranked = [...counts.keys()].sort(
    (a, b) =>
      counts.get(b)! - counts.get(a)! ||
      (a === null ? 1 : 0) - (b === null ? 1 : 0) ||
      (a ?? 0) - (b ?? 0),
  )
  const first = ranked[0] ?? null
  const second = ranked[1]
  if (second === undefined) {
    return first === null ? [0x20, DEFAULT, DEFAULT] : [0x2588, first, DEFAULT]
  }

  // The foreground is a color; the background is transparent when either choice is.
  const fg = first === null ? second! : second === null ? first : first
  const bg = first === null || second === null ? null : second
  let mask = 0
  pixels.forEach((p, i) => {
    let isFg: boolean
    if (p === fg) isFg = true
    else if (p === bg) isFg = false
    else if (p === null) isFg = false
    else if (bg === null) isFg = true
    else isFg = distance(p, fg) <= distance(p, bg)
    if (isFg) mask |= 1 << i
  })
  return [QUADRANTS[mask]!, mask === 0 ? DEFAULT : fg!, bg ?? DEFAULT]
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}

/** Packs a canvas into Raster cells, one quadrant block per 2 x 2 pixels. */
export function toCells(canvas: Canvas): string {
  const view = new DataView(new ArrayBuffer(W * ROWS * 12))
  let o = 0
  for (let r = 0; r < ROWS; r++) {
    const top = canvas[r * 2]!
    const bottom = canvas[r * 2 + 1]!
    for (let c = 0; c < W; c++) {
      const x = c * 2
      const [ch, fg, bg] = quadrant([top[x] ?? null, top[x + 1] ?? null, bottom[x] ?? null, bottom[x + 1] ?? null])
      view.setUint32(o, ch, true)
      view.setUint32(o + 4, fg, true)
      view.setUint32(o + 8, bg, true)
      o += 12
    }
  }
  return base64(new Uint8Array(view.buffer))
}
