import type { Mood, Species } from '../types'

/**
 * Pixel-art pets for the terminal: a canvas of W x H pixels drawn into a Raster
 * of W columns and H / 2 rows, each cell an upper half block whose foreground
 * is the top pixel and background the bottom one.
 */
export const W = 40
export const H = 20
export const ROWS = H / 2

const DEFAULT = 0x01000000

const PALETTE: Record<string, number> = {
  K: 0x2b2b2b, // outline
  W: 0xffffff,
  O: 0xf0a040, // cat fur
  D: 0xc06820, // cat stripes
  P: 0xff9ab0, // pink
  B: 0x9a6234, // dog fur / pikachu back
  L: 0xe8c9a0, // dog muzzle
  Y: 0xffd833, // pikachu
  R: 0xe03c31, // red
  G: 0x8a8a8a, // speed lines
  C: 0x7fc8ff, // sweat, z
  H: 0xff5c8a, // hearts
  S: 0xfff3a0, // sparkles
  g: 0xb5e04a, // tennis ball
}

type Sprite = readonly string[]

type Body = { sprite: Sprite; skin: string; eyes: readonly [number, number][]; ball: Sprite }

// 16 x 16 each; 'E' marks the 2 x 2 eyes, painted per expression.
const BODIES: Record<Species, Body> = {
  cat: {
    skin: 'O',
    eyes: [[3, 6], [10, 6]],
    ball: ['.H.', 'HHH', '.H.'],
    sprite: [
      '.KK.........KK..',
      '.KPK.......KPK..',
      '.KPOK.....KOPK..',
      '.KOOOKKKKKOOOK..',
      'KOOOODODODOOOOK.',
      'KOOOOOOOOOOOOOK.',
      'KOOEEOOOOOEEOOK.',
      'KOOEEOOOOOEEOOK.',
      'KWOOOOOPOOOOOWK.',
      '.KWOOOKOKOOOWK..',
      '..KKOOOOOOOKK...',
      '..KOOWWWWWOOK...',
      '.KOOOWWWWWOOOK..',
      '.KOOOWWWWWOOOKKK',
      '.KOOOWWWWWOOOKOK',
      '.KKWWKKKKKWWKKK.',
    ],
  },
  dog: {
    skin: 'B',
    eyes: [[5, 5], [8, 5]],
    ball: ['.g.', 'ggg', '.g.'],
    sprite: [
      '................',
      '...KKKKKKKKK....',
      '..KBBBBBBBBBK...',
      '.KDKBBBBBBBKDK..',
      'KDDKBBBBBBBKDDK.',
      'KDDKBEEBEEBKDDK.',
      'KDDKBEEBEEBKDDK.',
      'KDDKBLLLLLBKDDK.',
      '.KDKLLLKLLLKDK..',
      '..KKLLKLKLLKK...',
      '...KKLPPPLKK....',
      '...KBBLLLBBK....',
      '..KBBBLLLBBBK...',
      '..KBBBLLLBBBK.KK',
      '..KBBBLLLBBBKKBK',
      '..KKLLKKKLLKKK..',
    ],
  },
  pikachu: {
    skin: 'Y',
    eyes: [[3, 6], [10, 6]],
    ball: ['.RR.', 'KKKK', 'WWWW', '.WW.'],
    sprite: [
      'KK...........KK.',
      '.KK.........KK..',
      '.KYK.......KYK..',
      '..KYK.....KYK...',
      '..KYYKKKKKYYK...',
      '.KYYYYYYYYYYYK..',
      'KYYEEYYYYYEEYYK.',
      'KYYEEYYYYYEEYYK.',
      'KRRYYYYKYYYYRRK.',
      'KRRYYYKYKYYYRRK.',
      '.KYYYYYYYYYYYK.Y',
      '..KKYYYYYYYKK.YY',
      '..KYYYYYYYYYKYY.',
      '.KYYBYYYYYBYYKY.',
      '.KYYYYYYYYYYYKB.',
      '..KKYKKKKKYKK...',
    ],
  },
}

// 2 x 2 eye expressions; '.' keeps the skin.
const EYES = {
  open: ['WK', 'KK'],
  right: ['KW', 'KK'],
  closed: ['..', 'KK'],
  happy: ['KK', '..'],
  wide: ['WW', 'WK'],
} as const satisfies Record<string, Sprite>

const STAMPS = {
  z: ['CCC', '.C.', 'CCC'],
  bigZ: ['CCCC', '..C.', '.C..', 'CCCC'],
  heart: ['.H.H.', 'HHHHH', '.HHH.', '..H..'],
  sparkle: ['.S.', 'SSS', '.S.'],
  bolt: ['..YY', '.YY.', 'YYYY', '.YY.', 'YY..'],
  bang: ['R', 'R', 'R', '.', 'R'],
  question: ['WWW', '..W', '.W.', '...', '.W.'],
  sweat: ['.C', 'CC', 'CC'],
  bone: ['W....W', 'WWWWWW', 'W....W'],
} as const satisfies Record<string, Sprite>

type Canvas = (number | null)[][]

function stamp(canvas: Canvas, sprite: Sprite, x: number, y: number) {
  sprite.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!
      const line = canvas[y + dy]
      if (ch === '.' || !line || x + dx < 0 || x + dx >= W) continue
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
  const x = 22 + (step < span ? step : span * 2 - step)
  const y = H - 4 - (step % 4 === 1 || step % 4 === 2 ? 2 : 0)
  return [x, y]
}

/** The pet's pixels for this mood and animation frame, as rows of colors. */
export function paint(species: Species, mood: Mood, frame: number): Canvas {
  const canvas: Canvas = Array.from({ length: H }, () => Array<number | null>(W).fill(null))
  const body = BODIES[species]

  let bob = 0
  if (mood === 'busy' || mood === 'frantic') bob = frame % 2
  else if (mood === 'sleep') bob = Math.floor(frame / 4) % 2
  else if (mood === 'startled' || mood === 'happy') bob = frame % 2 ? 0 : -1
  else if (mood === 'play') bob = ballAt(frame)[0] < 25 ? -1 : 0

  const px = 4
  const py = 3 + bob
  stamp(canvas, body.sprite.map(row => row.replaceAll('E', body.skin)), px, py)
  const eyes = eyeStyle(mood, frame)
  for (const [ex, ey] of body.eyes) stamp(canvas, eyes, px + ex, py + ey)

  const rise = (offset: number) => 10 - ((frame + offset) % 10)
  switch (mood) {
    case 'sleep':
      stamp(canvas, STAMPS.z, 22, rise(0))
      stamp(canvas, STAMPS.bigZ, 27, rise(5) - 2)
      break
    case 'purr':
      stamp(canvas, STAMPS.heart, 22, rise(0))
      stamp(canvas, STAMPS.heart, 29, rise(5))
      break
    case 'groom':
      if (species === 'dog') stamp(canvas, STAMPS.bone, 21, 13)
      else if (species === 'pikachu') {
        stamp(canvas, STAMPS.sparkle, frame % 2 ? 2 : 1, py + 7)
        stamp(canvas, STAMPS.sparkle, frame % 2 ? 19 : 20, py + 7)
      } else stamp(canvas, STAMPS.heart, 22, rise(0))
      break
    case 'play': {
      const [bx, by] = ballAt(frame)
      stamp(canvas, body.ball, bx, by)
      break
    }
    case 'busy':
    case 'frantic':
      for (const y of [6, 10, 14]) stamp(canvas, [frame % 2 ? 'GGG' : '.GG'], 0, y + (frame % 2))
      if (mood === 'frantic') {
        stamp(canvas, STAMPS.sweat, 20, py + 1)
        stamp(canvas, species === 'pikachu' ? STAMPS.bolt : STAMPS.bang, 24, 2 + (frame % 2))
        if (species === 'pikachu') stamp(canvas, STAMPS.bolt, 30, 6 - (frame % 2))
      } else if (species === 'pikachu' && frame % 4 === 0) {
        stamp(canvas, STAMPS.bolt, 23, 4)
      }
      break
    case 'startled':
      stamp(canvas, species === 'pikachu' ? STAMPS.bolt : STAMPS.bang, 23, 2)
      if (species === 'pikachu') stamp(canvas, STAMPS.bolt, 29, 5)
      break
    case 'happy':
      stamp(canvas, STAMPS.sparkle, frame % 2 ? 22 : 24, 2)
      stamp(canvas, STAMPS.sparkle, frame % 2 ? 30 : 28, 8)
      stamp(canvas, STAMPS.sparkle, 0, frame % 2 ? 3 : 5)
      break
    case 'perk':
      stamp(canvas, STAMPS.question, 22, 1)
      break
  }
  return canvas
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

/** Packs a canvas into Raster cells: one upper half block per two pixels. */
export function toCells(canvas: Canvas): string {
  const view = new DataView(new ArrayBuffer(W * ROWS * 12))
  let o = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < W; c++) {
      const top = canvas[r * 2]![c] ?? null
      const bottom = canvas[r * 2 + 1]![c] ?? null
      let ch = 0x20
      let fg = DEFAULT
      let bg = DEFAULT
      if (top !== null) {
        ch = 0x2580 // ▀
        fg = top
        bg = bottom ?? DEFAULT
      } else if (bottom !== null) {
        ch = 0x2584 // ▄
        fg = bottom
      }
      view.setUint32(o, ch, true)
      view.setUint32(o + 4, fg, true)
      view.setUint32(o + 8, bg, true)
      o += 12
    }
  }
  return base64(new Uint8Array(view.buffer))
}
