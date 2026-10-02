import type { Mood, Species } from '../types'

// Vector drawings for the remote surfaces (desktop, editor, mobile): smooth
// shapes, gradients and highlights instead of pixels. The pet stands in the
// left half of a 400 x 200 view, its effects and toys play in the right half.

export const VIEW_W = 400
export const VIEW_H = 200
const CX = 110
const GROUND = 188

type EyeStyle = 'open' | 'right' | 'closed' | 'happy' | 'wide'

type Pose = {
  mood: Mood
  frame: number
  eyes: EyeStyle
  isMouthOpen: boolean
  /** Tail swing in degrees. */
  wag: number
}

type Fur = { light: string; base: string; dark: string; line: string }

type Look = {
  fur: Fur
  draw: (p: Pose) => string
  ball: (frame: number) => string
  /** Whether the toy rolls, so it turns as it goes. */
  isRolling: boolean
  floats?: boolean
  sleepy?: boolean
}

const n = (v: number) => Math.round(v * 10) / 10

/** The shape plus its mirror image across the pet's centre line. */
const both = (svg: string) => `${svg}<g transform="matrix(-1 0 0 1 ${CX * 2} 0)">${svg}</g>`

const outlined = (fur: Fur, width = 3) => `fill="url(#fur)" stroke="${fur.line}" stroke-width="${width}" stroke-linejoin="round"`

const filled = (color: string, line: string, width = 2.5) =>
  `fill="${color}" stroke="${line}" stroke-width="${width}" stroke-linejoin="round"`

/** A thick rounded stroke with an outline: tails, limbs. */
function limb(d: string, color: string, line: string, width: number, extra = '') {
  return (
    `<path d="${d}" fill="none" stroke="${line}" stroke-width="${width + 5}" stroke-linecap="round" ${extra}/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`
  )
}

function gradient(fur: Fur) {
  return (
    `<radialGradient id="fur" cx="38%" cy="30%" r="80%">` +
    `<stop offset="0" stop-color="${fur.light}"/><stop offset=".55" stop-color="${fur.base}"/><stop offset="1" stop-color="${fur.dark}"/>` +
    `</radialGradient>`
  )
}

type EyeOptions = { r: number; ink?: string; iris?: string; ring?: string }

function eye(x: number, y: number, style: EyeStyle, o: EyeOptions) {
  const { r } = o
  const ink = o.ink ?? '#232323'
  const ring = o.ring ? `<circle cx="${x}" cy="${y}" r="${n(r * 1.35)}" fill="${o.ring}"/>` : ''
  switch (style) {
    case 'closed':
      return `<path d="M${n(x - r)} ${y} Q${x} ${n(y + r * 0.9)} ${n(x + r)} ${y}" fill="none" stroke="${ink}" stroke-width="${n(r * 0.42)}" stroke-linecap="round"/>`
    case 'happy':
      return `<path d="M${n(x - r)} ${n(y + r * 0.35)} Q${x} ${n(y - r * 1.1)} ${n(x + r)} ${n(y + r * 0.35)}" fill="none" stroke="${ink}" stroke-width="${n(r * 0.42)}" stroke-linecap="round"/>`
    case 'wide':
      return (
        `<circle cx="${x}" cy="${y}" r="${n(r * 1.3)}" fill="#fff" stroke="${ink}" stroke-width="${n(r * 0.22)}"/>` +
        `<circle cx="${x}" cy="${y}" r="${n(r * 0.5)}" fill="${ink}"/>` +
        `<circle cx="${n(x - r * 0.18)}" cy="${n(y - r * 0.22)}" r="${n(r * 0.17)}" fill="#fff"/>`
      )
    default: {
      const dx = style === 'right' ? r * 0.3 : 0
      const cx = n(x + dx)
      const iris = o.iris
        ? `<ellipse cx="${cx}" cy="${y}" rx="${n(r * 0.85)}" ry="${r}" fill="${o.iris}"/>` +
          `<ellipse cx="${cx}" cy="${n(y + r * 0.1)}" rx="${n(r * 0.45)}" ry="${n(r * 0.6)}" fill="${ink}"/>`
        : `<ellipse cx="${cx}" cy="${y}" rx="${n(r * 0.8)}" ry="${r}" fill="${ink}"/>`
      return (
        ring +
        iris +
        `<circle cx="${n(cx - r * 0.28)}" cy="${n(y - r * 0.38)}" r="${n(r * 0.33)}" fill="#fff"/>` +
        `<circle cx="${n(cx + r * 0.3)}" cy="${n(y + r * 0.42)}" r="${n(r * 0.14)}" fill="#fff" opacity=".85"/>`
      )
    }
  }
}

const eyes = (y: number, gap: number, style: EyeStyle, o: EyeOptions) =>
  eye(CX - gap, y, style, o) + eye(CX + gap, y, style, o)

/** A cat-like "w" mouth, or an open one. */
function mouth(y: number, isOpen: boolean, line: string, w = 7) {
  if (isOpen) {
    return (
      `<path d="M${CX - w} ${y} Q${CX} ${y + w * 2} ${CX + w} ${y} Z" fill="#7a2a3a" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M${CX - w * 0.55} ${y + w * 0.9} Q${CX} ${y + w * 0.4} ${CX + w * 0.55} ${y + w * 0.9} Q${CX} ${y + w * 1.45} ${CX - w * 0.55} ${y + w * 0.9}Z" fill="#ff8a9e"/>`
    )
  }
  return `<path d="M${CX - w} ${y} Q${CX - w / 2} ${y + w * 0.75} ${CX} ${y} Q${CX + w / 2} ${y + w * 0.75} ${CX + w} ${y}" fill="none" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>`
}

const blush = (x: number, y: number, rx = 8, ry = 5, color = '#ff8aa8', opacity = 0.55) =>
  both(`<ellipse cx="${CX - x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${opacity}"/>`)

// ---------------------------------------------------------------- the pets

const CAT: Look = {
  fur: { light: '#ffd394', base: '#f2a344', dark: '#c9721f', line: '#7a3f10' },
  isRolling: true,
  ball: () => yarn(),
  draw(p) {
    const { line } = CAT.fur
    const stripe = '#c0661c'
    return (
      `<g transform="rotate(${p.wag} 150 168)">${limb('M146 172 C188 172 196 128 176 104', '#e8932f', line, 13)}` +
      `<path d="M181 112 l-11 4 M186 124 l-12 1" stroke="${stripe}" stroke-width="4" stroke-linecap="round"/></g>` +
      `<ellipse cx="${CX}" cy="152" rx="45" ry="35" ${outlined(CAT.fur)}/>` +
      `<ellipse cx="${CX}" cy="160" rx="25" ry="24" fill="#fff3df"/>` +
      both(`<ellipse cx="92" cy="182" rx="13" ry="8" ${filled('#fff3df', line)}/>` +
        `<path d="M88 182 v4 M93 182 v5 M98 182 v4" stroke="${line}" stroke-width="1.4" opacity=".5"/>`) +
      both(`<path d="M72 80 L66 30 L106 58 Z" ${outlined(CAT.fur)}/><path d="M76 70 L73 42 L96 59 Z" fill="#ff9ab0"/>`) +
      `<ellipse cx="${CX}" cy="92" rx="50" ry="41" ${outlined(CAT.fur)}/>` +
      `<path d="M${CX} 54 v13 M98 56 l3 11 M122 56 l-3 11" stroke="${stripe}" stroke-width="4.5" stroke-linecap="round"/>` +
      both(`<path d="M60 92 h9 M61 100 h8" stroke="${stripe}" stroke-width="4" stroke-linecap="round"/>`) +
      `<ellipse cx="${CX}" cy="108" rx="19" ry="13" fill="#fff3df"/>` +
      eyes(91, 19, p.eyes, { r: 7.5 }) +
      blush(31, 106) +
      `<path d="M104 101 h12 l-6 6.5 z" fill="#ff7a9a" stroke="${line}" stroke-width="1.5" stroke-linejoin="round"/>` +
      mouth(108, p.isMouthOpen, line, 6) +
      both(`<path d="M86 104 L50 98 M86 110 L52 112" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>`)
    )
  },
}

const DOG: Look = {
  fur: { light: '#cf9a62', base: '#a46a38', dark: '#74461f', line: '#3f230d' },
  isRolling: true,
  ball: () => tennisBall(),
  draw(p) {
    const { line } = DOG.fur
    const ear = '#5e3a1e'
    const flap = p.mood === 'play' || p.mood === 'happy' || p.mood === 'busy' || p.mood === 'frantic' ? (p.frame % 2 ? 8 : -4) : 0
    return (
      `<g transform="rotate(${-p.wag * 1.4} 148 160)">${limb('M146 162 C172 156 182 138 176 116', '#a46a38', line, 12)}</g>` +
      `<ellipse cx="${CX}" cy="152" rx="45" ry="35" ${outlined(DOG.fur)}/>` +
      `<ellipse cx="${CX}" cy="158" rx="24" ry="25" fill="#f0d6b0"/>` +
      both(`<ellipse cx="92" cy="182" rx="13" ry="8" ${filled('#f0d6b0', line)}/>`) +
      `<ellipse cx="${CX}" cy="90" rx="47" ry="41" ${outlined(DOG.fur)}/>` +
      both(`<g transform="rotate(${flap} 78 66)"><path d="M78 60 C54 58 44 100 56 124 C70 128 80 98 84 70 Z" ${filled(ear, line, 3)}/></g>`) +
      `<path d="M${CX} 52 C100 64 100 80 ${CX} 84 C120 80 120 64 ${CX} 52 Z" fill="#f0d6b0" opacity=".9"/>` +
      `<ellipse cx="${CX}" cy="108" rx="24" ry="17" fill="#f0d6b0"/>` +
      eyes(86, 19, p.eyes, { r: 7 }) +
      both(`<ellipse cx="92" cy="74" rx="5" ry="3" fill="#f0d6b0"/>`) +
      `<ellipse cx="${CX}" cy="100" rx="9" ry="6.5" fill="#262626"/><ellipse cx="107" cy="98" rx="3" ry="1.6" fill="#fff" opacity=".7"/>` +
      `<path d="M${CX} 106 v6 M${CX} 112 Q104 118 97 114 M${CX} 112 Q116 118 123 114" fill="none" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>` +
      (p.isMouthOpen || p.mood === 'play' || p.mood === 'busy'
        ? `<path d="M104 115 h12 v9 a6 6 0 0 1 -12 0 Z" fill="#ff7f96" stroke="#c0485e" stroke-width="1.5"/><path d="M${CX} 116 v8" stroke="#c0485e" stroke-width="1.2"/>`
        : '')
    )
  },
}

const PIKACHU: Look = {
  fur: { light: '#fff27e', base: '#ffd630', dark: '#e3a800', line: '#7a5600' },
  isRolling: true,
  ball: () => pokeBall(),
  draw(p) {
    const { line } = PIKACHU.fur
    const tail = 'M146 166 L162 144 L150 136 L174 108 L162 100 L194 62 L204 72 L184 98 L196 104 L172 134 L182 140 L156 172 Z'
    const earPath = 'M82 64 C68 42 56 22 46 6 C66 10 88 32 98 56 Z'
    return (
      `<defs><clipPath id="ear" clipPathUnits="userSpaceOnUse"><path d="${earPath}"/></clipPath></defs>` +
      `<g transform="rotate(${p.wag} 150 166)"><path d="${tail}" ${outlined(PIKACHU.fur)}/>` +
      `<path d="M146 166 L156 152 L166 160 L156 172 Z" fill="#9a5a2a"/></g>` +
      `<ellipse cx="${CX}" cy="150" rx="43" ry="37" ${outlined(PIKACHU.fur)}/>` +
      both(`<ellipse cx="92" cy="183" rx="13" ry="7" ${outlined(PIKACHU.fur, 2.5)}/>` +
        `<ellipse cx="92" cy="140" rx="8" ry="11" transform="rotate(-25 92 140)" ${outlined(PIKACHU.fur, 2.5)}/>`) +
      both(`<path d="${earPath}" ${outlined(PIKACHU.fur)}/>` +
        `<g clip-path="url(#ear)"><path d="M30 0 L74 0 L60 34 L30 40 Z" fill="#262626"/></g>` +
        `<path d="${earPath}" fill="none" stroke="${line}" stroke-width="3" stroke-linejoin="round"/>`) +
      `<ellipse cx="${CX}" cy="92" rx="48" ry="39" ${outlined(PIKACHU.fur)}/>` +
      eyes(88, 21, p.eyes, { r: 7.5 }) +
      both(`<circle cx="76" cy="107" r="10" fill="#e8402f"/><circle cx="73" cy="104" r="3" fill="#fff" opacity=".45"/>`) +
      `<ellipse cx="${CX}" cy="98" rx="2.6" ry="1.7" fill="#262626"/>` +
      mouth(103, p.isMouthOpen, line, 7)
    )
  },
}

const MEW: Look = {
  fur: { light: '#ffe6f2', base: '#ffb8d9', dark: '#e58cb7', line: '#a8467a' },
  isRolling: false,
  floats: true,
  ball: () => bubble(),
  draw(p) {
    const { line } = MEW.fur
    const sway = Math.sin(p.frame * 0.7) * 6
    return (
      `<g transform="rotate(${n(p.wag * 0.6)} 134 150)">` +
      limb(`M132 152 C176 166 ${n(204 + sway)} 128 192 96 C182 70 ${n(198 + sway)} 50 ${n(214 + sway)} 54`, '#ffb8d9', line, 5) +
      `<ellipse cx="${n(218 + sway)}" cy="54" rx="11" ry="7" transform="rotate(-20 ${n(218 + sway)} 54)" ${outlined(MEW.fur, 2.5)}/></g>` +
      both(`<ellipse cx="100" cy="166" rx="7" ry="14" transform="rotate(12 100 166)" ${outlined(MEW.fur, 2.5)}/>`) +
      `<ellipse cx="${CX}" cy="142" rx="24" ry="25" ${outlined(MEW.fur)}/>` +
      both(`<ellipse cx="92" cy="136" rx="6" ry="9" transform="rotate(30 92 136)" ${outlined(MEW.fur, 2.5)}/>`) +
      both(`<path d="M80 74 L70 44 L100 62 Z" ${outlined(MEW.fur)}/><path d="M81 68 L76 51 L94 62 Z" fill="#ff9ccb"/>`) +
      `<ellipse cx="${CX}" cy="98" rx="42" ry="35" ${outlined(MEW.fur)}/>` +
      eyes(97, 17, p.eyes, { r: 11, iris: '#3f8fe8', ink: '#1a2a58' }) +
      blush(30, 113, 7, 4) +
      (p.isMouthOpen ? mouth(114, true, line, 5) : `<path d="M104 115 Q${CX} 120 116 115" fill="none" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`)
    )
  },
}

const SNORLAX: Look = {
  fur: { light: '#4fa0ab', base: '#2f6f7a', dark: '#1d4b53', line: '#0f2c31' },
  isRolling: true,
  sleepy: true,
  ball: () => apple(),
  draw(p) {
    const { line } = SNORLAX.fur
    const cream = '#f3e4c2'
    const scratch = p.mood === 'groom' ? (p.frame % 2 ? -6 : 4) : 0
    return (
      `<ellipse cx="${CX}" cy="140" rx="68" ry="50" ${outlined(SNORLAX.fur)}/>` +
      `<ellipse cx="${CX}" cy="150" rx="48" ry="38" fill="${cream}" stroke="${line}" stroke-width="2" opacity=".97"/>` +
      `<g transform="rotate(${scratch} 52 124)">${both(`<ellipse cx="50" cy="140" rx="15" ry="24" transform="rotate(20 50 140)" ${outlined(SNORLAX.fur, 2.5)}/>` +
        `<path d="M42 160 l-3 6 M48 162 l-1 7 M54 162 l1 6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`)}</g>` +
      both(`<ellipse cx="72" cy="180" rx="20" ry="11" ${filled(cream, line)}/>` +
        `<path d="M62 174 l-2 -6 M72 172 v-7 M82 174 l2 -6" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>`) +
      both(`<path d="M80 66 L76 46 L94 58 Z" ${outlined(SNORLAX.fur, 2.5)}/>`) +
      `<ellipse cx="${CX}" cy="86" rx="42" ry="31" ${outlined(SNORLAX.fur)}/>` +
      `<path d="M78 92 C80 74 96 70 ${CX} 82 C124 70 140 74 142 92 C140 110 124 116 ${CX} 116 C96 116 80 110 78 92 Z" fill="${cream}"/>` +
      eyes(90, 15, p.eyes, { r: 6 }) +
      (p.isMouthOpen
        ? mouth(102, true, line, 8)
        : `<path d="M97 104 Q${CX} 110 123 104" fill="none" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>` +
          both(`<path d="M100 105 l2 5 l2 -4 Z" fill="#fff" stroke="${line}" stroke-width="1"/>`))
    )
  },
}

const JIGGLYPUFF: Look = {
  fur: { light: '#ffe3ee', base: '#ffb3cf', dark: '#f084ab', line: '#a8406a' },
  isRolling: false,
  ball: () => microphone(),
  draw(p) {
    const { line } = JIGGLYPUFF.fur
    const puff = p.mood === 'frantic' || p.mood === 'startled' ? 1.08 : 1
    return (
      both(`<ellipse cx="92" cy="180" rx="15" ry="8" ${outlined(JIGGLYPUFF.fur, 2.5)}/>`) +
      `<g transform="translate(${CX} 122) scale(${puff}) translate(${-CX} -122)">` +
      both(`<path d="M64 92 L58 52 L92 76 Z" ${outlined(JIGGLYPUFF.fur)}/><path d="M67 84 L64 62 L84 77 Z" fill="#3a2430"/>`) +
      both(`<ellipse cx="54" cy="130" rx="9" ry="12" ${outlined(JIGGLYPUFF.fur, 2.5)}/>`) +
      `<circle cx="${CX}" cy="122" r="57" ${outlined(JIGGLYPUFF.fur)}/>` +
      `<path d="M${CX} 66 C92 58 86 84 104 88 C120 90 122 72 110 74 C104 76 106 82 110 82" fill="none" stroke="${line}" stroke-width="9" stroke-linecap="round"/>` +
      `<path d="M${CX} 66 C92 58 86 84 104 88 C120 90 122 72 110 74 C104 76 106 82 110 82" fill="none" stroke="#ffc4da" stroke-width="5" stroke-linecap="round"/>` +
      eyes(118, 23, p.eyes, { r: 15, iris: '#2aa198', ink: '#0f3a36' }) +
      blush(36, 140, 7, 4) +
      (p.isMouthOpen || p.mood === 'purr' ? mouth(146, true, line, 6) : `<path d="M104 148 Q${CX} 152 116 148" fill="none" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`) +
      `</g>`
    )
  },
}

const TOGEPI: Look = {
  fur: { light: '#fffbe2', base: '#fff0a8', dark: '#e9d27e', line: '#8a7630' },
  isRolling: false,
  ball: () => star(12),
  draw(p) {
    const { line } = TOGEPI.fur
    const hide = p.mood === 'startled' ? 16 : 0
    const wobble = p.mood === 'frantic' || p.mood === 'busy' ? (p.frame % 2 ? 4 : -4) : p.mood === 'sit' ? Math.sin(p.frame * 0.8) * 2 : 0
    const spikes = [84, 97, 110, 123, 136].map((x, i) => {
      const tip = 42 + Math.abs(i - 2) * 9
      return `<path d="M${x - 9} 74 L${x} ${tip} L${x + 9} 74 Z" ${outlined(TOGEPI.fur, 2.5)}/>`
    })
    const zig = Array.from({ length: 14 }, (_, i) => `L${58 + (i + 1) * 7.5} ${i % 2 ? 120 : 108}`).join(' ')
    return (
      `<g transform="rotate(${n(wobble)} ${CX} 186)">` +
      `<g transform="translate(0 ${hide})">${spikes.join('')}` +
      both(`<ellipse cx="70" cy="116" rx="7" ry="8" ${outlined(TOGEPI.fur, 2.5)}/>`) +
      `<ellipse cx="${CX}" cy="98" rx="38" ry="34" ${outlined(TOGEPI.fur)}/>` +
      eyes(97, 14, p.eyes, { r: 6.5 }) +
      blush(26, 109, 6, 3.5) +
      (p.isMouthOpen ? mouth(108, true, line, 5) : `<path d="M104 109 Q${CX} 115 116 109" fill="none" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`) +
      `</g>` +
      `<linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e3d6"/></linearGradient>` +
      `<path d="M58 120 ${zig} L163 140 C163 176 140 190 ${CX} 190 C80 190 57 176 57 140 Z" fill="url(#shell)" stroke="#8a8676" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M74 152 l11 -16 l11 16 z" fill="#e8463a"/><path d="M122 164 l11 -16 l11 16 z" fill="#3a7bd5"/>` +
      `<path d="M100 178 l8 -12 l8 12 z" fill="#3a7bd5"/><path d="M134 136 l7 -10 l7 10 z" fill="#e8463a"/>` +
      `</g>`
    )
  },
}

const SHIBA: Look = {
  fur: { light: '#f8bc78', base: '#e38c3e', dark: '#b8621e', line: '#5e300c' },
  isRolling: true,
  ball: () => redBall(),
  draw(p) {
    const { line } = SHIBA.fur
    const cream = '#fff1dc'
    return (
      `<g transform="rotate(${-p.wag} 150 150)">` +
      limb('M146 156 C178 156 186 122 166 110 C150 102 138 120 152 130', '#e38c3e', line, 13) +
      `<path d="M168 118 C176 126 172 140 160 146" fill="none" stroke="${cream}" stroke-width="4" stroke-linecap="round"/></g>` +
      `<ellipse cx="${CX}" cy="152" rx="44" ry="35" ${outlined(SHIBA.fur)}/>` +
      `<ellipse cx="${CX}" cy="158" rx="25" ry="26" fill="${cream}"/>` +
      both(`<ellipse cx="92" cy="182" rx="13" ry="8" ${filled(cream, line)}/>`) +
      both(`<path d="M70 74 L74 32 L104 58 Z" ${outlined(SHIBA.fur)}/><path d="M76 66 L78 44 L96 59 Z" fill="${cream}"/>`) +
      `<ellipse cx="${CX}" cy="90" rx="48" ry="39" ${outlined(SHIBA.fur)}/>` +
      `<path d="M64 98 C70 124 150 124 156 98 C144 110 124 96 ${CX} 100 C96 96 76 110 64 98 Z" fill="${cream}"/>` +
      `<ellipse cx="${CX}" cy="106" rx="20" ry="13" fill="${cream}"/>` +
      both(`<ellipse cx="92" cy="74" rx="5" ry="3.5" fill="${cream}"/>`) +
      eyes(87, 19, p.eyes, { r: 6 }) +
      `<ellipse cx="${CX}" cy="100" rx="7" ry="5" fill="#262626"/><ellipse cx="108" cy="98.5" rx="2.4" ry="1.3" fill="#fff" opacity=".7"/>` +
      (p.isMouthOpen || p.mood === 'purr'
        ? `<path d="M96 108 Q${CX} 124 124 108 Z" fill="#7a2a3a" stroke="${line}" stroke-width="2"/><path d="M103 114 Q${CX} 110 117 114 Q${CX} 122 103 114Z" fill="#ff8a9e"/>`
        : `<path d="M${CX} 105 v4 M${CX} 109 Q104 114 99 111 M${CX} 109 Q116 114 121 111" fill="none" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>`) +
      blush(34, 108, 7, 4, '#ff8a6a', 0.35)
    )
  },
}

const RACCOON: Look = {
  fur: { light: '#cfcfcf', base: '#9c9c9c', dark: '#6e6e6e', line: '#2e2e2e' },
  isRolling: false,
  ball: frame => coin(frame),
  draw(p) {
    const { line } = RACCOON.fur
    const mask = '#333'
    const tail = 'M146 168 C186 168 198 136 188 106'
    // Shut eyes are drawn light, so they show on the dark mask.
    const shut = p.eyes === 'closed' || p.eyes === 'happy'
    return (
      `<g transform="rotate(${p.wag} 150 168)">` +
      limb(tail, '#a0a0a0', line, 19) +
      `<path d="${tail}" fill="none" stroke="${mask}" stroke-width="19" stroke-dasharray="9 9" stroke-dashoffset="-4"/>` +
      `<circle cx="188" cy="106" r="9.5" fill="${mask}"/></g>` +
      `<ellipse cx="${CX}" cy="152" rx="45" ry="35" ${outlined(RACCOON.fur)}/>` +
      `<ellipse cx="${CX}" cy="158" rx="25" ry="25" fill="#dedede"/>` +
      both(`<ellipse cx="92" cy="182" rx="12" ry="8" ${filled('#3a3a3a', line)}/>`) +
      both(`<ellipse cx="76" cy="58" rx="14" ry="16" ${outlined(RACCOON.fur)}/><ellipse cx="76" cy="60" rx="7" ry="9" fill="${mask}"/>`) +
      `<ellipse cx="${CX}" cy="92" rx="50" ry="39" ${outlined(RACCOON.fur)}/>` +
      both(`<ellipse cx="91" cy="74" rx="16" ry="7" fill="#f4f4f4"/>`) +
      `<path d="M62 92 C68 76 96 78 ${CX} 90 C124 78 152 76 158 92 C152 106 124 106 ${CX} 99 C96 106 68 106 62 92 Z" fill="${mask}"/>` +
      `<ellipse cx="${CX}" cy="110" rx="19" ry="13" fill="#f4f4f4"/>` +
      (shut
        ? eyes(91, 21, p.eyes, { r: 6, ink: '#f4f4f4' })
        : eyes(91, 21, p.eyes, { r: 6, ink: '#151515', ring: '#f4f4f4' })) +
      `<ellipse cx="${CX}" cy="103" rx="7" ry="5" fill="#151515"/><ellipse cx="108" cy="101.5" rx="2.4" ry="1.3" fill="#fff" opacity=".7"/>` +
      mouth(110, p.isMouthOpen, line, 6)
    )
  },
}

const PENGU: Look = {
  fur: { light: '#5878b4', base: '#354d82', dark: '#1f2f56', line: '#101a34' },
  isRolling: false,
  ball: frame => fish(frame),
  draw(p) {
    const { line } = PENGU.fur
    const flapping = p.mood === 'purr' || p.mood === 'frantic' || p.mood === 'happy' || p.mood === 'busy'
    const flap = flapping ? (p.frame % 2 ? 28 : 0) : 0
    const waddle = p.mood === 'busy' || p.mood === 'frantic' || p.mood === 'happy' ? (p.frame % 2 ? 5 : -5) : 0
    return (
      `<g transform="rotate(${waddle} ${CX} 186)">` +
      both(`<ellipse cx="94" cy="185" rx="15" ry="6" ${filled('#f6a13a', '#a85c10')}/>`) +
      both(`<g transform="rotate(${flap} 64 116)"><path d="M64 112 C44 122 38 150 46 166 C56 158 64 140 68 124 Z" ${outlined(PENGU.fur, 2.5)}/></g>`) +
      `<path d="M${CX} 46 C152 46 166 88 166 128 C166 166 144 186 ${CX} 186 C76 186 54 166 54 128 C54 88 68 46 ${CX} 46 Z" ${outlined(PENGU.fur)}/>` +
      `<ellipse cx="${CX}" cy="146" rx="40" ry="38" fill="#f7f8fb"/>` +
      `<path d="M${CX} 84 C96 70 70 74 70 98 C70 118 90 124 ${CX} 122 C130 124 150 118 150 98 C150 74 124 70 ${CX} 84 Z" fill="#f7f8fb"/>` +
      eyes(96, 17, p.eyes, { r: 7 }) +
      blush(30, 110, 7, 4.5, '#ff8aa8', 0.7) +
      (p.isMouthOpen
        ? `<path d="M99 106 Q${CX} 100 121 106 L${CX} 110 Z" fill="#f6a13a" stroke="#a85c10" stroke-width="1.8" stroke-linejoin="round"/><path d="M101 111 L${CX} 110 L119 111 Q${CX} 122 101 111 Z" fill="#e8892a" stroke="#a85c10" stroke-width="1.8" stroke-linejoin="round"/>`
        : `<path d="M99 106 Q${CX} 100 121 106 Q${CX} 120 99 106 Z" fill="#f6a13a" stroke="#a85c10" stroke-width="1.8" stroke-linejoin="round"/>`) +
      `</g>`
    )
  },
}

const LOOKS: Record<Species, Look> = {
  cat: CAT,
  dog: DOG,
  pikachu: PIKACHU,
  mew: MEW,
  snorlax: SNORLAX,
  jigglypuff: JIGGLYPUFF,
  togepi: TOGEPI,
  shiba: SHIBA,
  raccoon: RACCOON,
  pengu: PENGU,
}

// ---------------------------------------------------------------- toys

function yarn() {
  return (
    `<path d="M-11 5 q-10 8 -22 2" fill="none" stroke="#e0507e" stroke-width="2" stroke-linecap="round"/>` +
    `<circle r="12" fill="#ff7aa6" stroke="#b83a66" stroke-width="2"/>` +
    `<path d="M-10 -5 Q0 -14 10 -5 M-11.5 1 Q0 -8 11.5 1 M-9 7 Q0 0 9 7 M-4 -11 Q6 0 -2 11" fill="none" stroke="#b83a66" stroke-width="1.6"/>`
  )
}

function tennisBall() {
  return (
    `<circle r="11" fill="#cde84c" stroke="#7a9a1a" stroke-width="2"/>` +
    `<path d="M-8 -7 Q-1 0 -8 7 M8 -7 Q1 0 8 7" fill="none" stroke="#fff" stroke-width="2.2"/>` +
    `<circle cx="-4" cy="-5" r="2.5" fill="#fff" opacity=".5"/>`
  )
}

function pokeBall() {
  return (
    `<path d="M-12 0 A12 12 0 0 1 12 0 Z" fill="#e8402f"/><path d="M-12 0 A12 12 0 0 0 12 0 Z" fill="#fafafa"/>` +
    `<circle r="12" fill="none" stroke="#222" stroke-width="2.2"/><path d="M-12 0 H12" stroke="#222" stroke-width="3"/>` +
    `<circle r="4.2" fill="#fafafa" stroke="#222" stroke-width="2.2"/><circle cx="-5" cy="-6" r="2.4" fill="#fff" opacity=".6"/>`
  )
}

function bubble() {
  return (
    `<circle r="13" fill="#9fd8ff" fill-opacity=".22" stroke="#9fd8ff" stroke-width="2"/>` +
    `<path d="M-8 -4 A9 9 0 0 1 -2 -9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` +
    `<circle cx="6" cy="6" r="1.6" fill="#fff" opacity=".7"/>`
  )
}

function apple() {
  return (
    `<path d="M0 -6 C-4 -12 -14 -10 -13 0 C-12 10 -5 14 0 11 C5 14 12 10 13 0 C14 -10 4 -12 0 -6 Z" fill="#e33c2f" stroke="#8a1a12" stroke-width="2"/>` +
    `<path d="M0 -6 Q1 -12 3 -15" fill="none" stroke="#6a3a1a" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M3 -12 Q10 -16 12 -10 Q6 -8 3 -12 Z" fill="#6cc04a"/><ellipse cx="-6" cy="-3" rx="2.5" ry="4" fill="#fff" opacity=".45"/>`
  )
}

function microphone() {
  return (
    `<g transform="rotate(-20)"><rect x="-3.5" y="2" width="7" height="22" rx="3" fill="#2b2b2b" stroke="#111" stroke-width="1.5"/>` +
    `<circle cy="-6" r="10" fill="#b8b8c4" stroke="#55555e" stroke-width="2"/>` +
    `<path d="M-9 -6 H9 M-7 -11 H7 M-7 -1 H7 M0 -15 V3 M-5 -14 V2 M5 -14 V2" stroke="#7a7a86" stroke-width="1"/>` +
    `<circle cx="-4" cy="-10" r="2.4" fill="#fff" opacity=".6"/></g>`
  )
}

function star(r: number, fill = '#ffe066', line = '#c49a00') {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const radius = i % 2 ? r * 0.45 : r
    return `${n(Math.cos(a) * radius)},${n(Math.sin(a) * radius)}`
  })
  return `<polygon points="${points.join(' ')}" fill="${fill}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>`
}

function redBall() {
  return (
    `<circle r="11" fill="#e8402f" stroke="#8a1a12" stroke-width="2"/>` +
    `<path d="M-11 0 Q0 6 11 0" fill="none" stroke="#fff" stroke-width="2"/>` +
    `<ellipse cx="-4" cy="-5" rx="3.5" ry="2.4" fill="#fff" opacity=".55"/>`
  )
}

function coin(frame: number) {
  const turn = n(Math.abs(Math.cos(frame * 0.9)) * 0.85 + 0.15)
  return (
    `<g transform="scale(${turn} 1)"><circle r="11" fill="#ffd23a" stroke="#a87c00" stroke-width="2"/>` +
    `<circle r="7" fill="none" stroke="#e0a800" stroke-width="1.6"/><path d="M-2 -4 h4 M0 -4 v8" stroke="#a87c00" stroke-width="1.8"/></g>` +
    `<path d="M-6 -6 l3 3" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>`
  )
}

function fish(frame: number) {
  const flick = frame % 2 ? 8 : -8
  return (
    `<g transform="rotate(${flick})">` +
    `<path d="M-14 0 C-6 -10 8 -10 14 0 C8 10 -6 10 -14 0 Z" fill="#8fd0ff" stroke="#2f6fa8" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M14 0 L24 -8 L22 0 L24 8 Z" fill="#8fd0ff" stroke="#2f6fa8" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="-7" cy="-2" r="1.8" fill="#1a2a3a"/><path d="M0 -6 Q3 0 0 6" fill="none" stroke="#2f6fa8" stroke-width="1.4"/></g>`
  )
}

// ---------------------------------------------------------------- effects

const at = (x: number, y: number, svg: string, scale = 1) =>
  `<g transform="translate(${n(x)} ${n(y)})${scale === 1 ? '' : ` scale(${scale})`}">${svg}</g>`

const HEART = `<path d="M0 12 C-15 3 -13 -10 -5.5 -10 C-2.5 -10 0 -7.5 0 -4.5 C0 -7.5 2.5 -10 5.5 -10 C13 -10 15 3 0 12 Z" fill="#ff5c8a" stroke="#b02a58" stroke-width="2" stroke-linejoin="round"/><ellipse cx="-6" cy="-5" rx="2.4" ry="1.6" fill="#fff" opacity=".6"/>`
const NOTE = `<path d="M3 6 V-12 Q10 -10 12 -4" fill="none" stroke="#ff6aa8" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="-1" cy="6" rx="5" ry="3.8" transform="rotate(-20 -1 6)" fill="#ff6aa8"/>`
const SPARKLE = `<path d="M0 -12 Q1.6 -1.6 12 0 Q1.6 1.6 0 12 Q-1.6 1.6 -12 0 Q-1.6 -1.6 0 -12 Z" fill="#fff3a0" stroke="#e8c840" stroke-width="1.2"/>`
const BOLT = `<path d="M4 -16 L-8 2 L-1 2 L-5 16 L9 -4 L2 -4 Z" fill="#ffd630" stroke="#9a7000" stroke-width="2" stroke-linejoin="round"/>`
const BANG = `<rect x="-3.5" y="-16" width="7" height="20" rx="3.5" fill="#ff4a3a"/><circle cy="11" r="4" fill="#ff4a3a"/>`
const QUESTION = `<path d="M-7 -7 C-7 -17 7 -17 7 -7 C7 -1 0 -1 0 6" fill="none" stroke="#7fc8ff" stroke-width="4.5" stroke-linecap="round"/><circle cy="14" r="3" fill="#7fc8ff"/>`
const DROP = `<path d="M0 -9 C4 -3 7 1 7 4 A7 7 0 0 1 -7 4 C-7 1 -4 -3 0 -9 Z" fill="#7fc8ff" stroke="#3a8ac8" stroke-width="1.5"/><ellipse cx="-2.5" cy="3" rx="1.6" ry="2.4" fill="#fff" opacity=".7"/>`
const BONE = `<g fill="#f4f0e4" stroke="#b0a890" stroke-width="1.5"><circle cx="-15" cy="-4" r="5"/><circle cx="-15" cy="4" r="5"/><circle cx="15" cy="-4" r="5"/><circle cx="15" cy="4" r="5"/></g><rect x="-15" y="-4" width="30" height="8" fill="#f4f0e4"/><path d="M-12 -4 H12 M-12 4 H12" stroke="#b0a890" stroke-width="1.5"/>`
const PSY = `<circle r="10" fill="none" stroke="#e080c0" stroke-width="2.5" opacity=".9"/><circle r="5" fill="none" stroke="#e080c0" stroke-width="2" opacity=".6"/><circle r="1.8" fill="#ffc0e4"/>`
const SPARKS = `<path d="M-8 -10 L0 -3 L-5 0 L6 10" fill="none" stroke="#ffe066" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`

function zee(size: number) {
  return `<path d="M0 0 H${size} L0 ${size} H${size}" fill="none" stroke="#9fd4ff" stroke-width="${n(size / 5)}" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** Floats up over ten frames and fades out near the top. */
function rising(frame: number, offset: number) {
  const step = (frame + offset) % 10
  return { y: 120 - step * 11, opacity: n(Math.min(1, (10 - step) / 4)) }
}

function floating(svg: string, x: number, frame: number, offset: number, scale = 1.4) {
  const r = rising(frame, offset)
  return `<g opacity="${r.opacity}">${at(x + Math.sin((frame + offset) * 0.9) * 4, r.y, svg, scale)}</g>`
}

function ballAt(frame: number): [number, number, number] {
  const span = 14
  const step = frame % (span * 2)
  const x = 246 + 8.5 * (step < span ? step : span * 2 - step)
  const bounce = step % 4 === 1 || step % 4 === 2 ? 16 : 0
  return [x, GROUND - 20 - bounce, bounce]
}

function effects(species: Species, look: Look, mood: Mood, frame: number) {
  const power = species === 'pikachu' ? BOLT : species === 'mew' ? PSY : undefined
  switch (mood) {
    case 'sleep':
      return floating(zee(16), 236, frame, 0) + floating(zee(26), 276, frame, 5)
    case 'purr': {
      const love = species === 'jigglypuff' ? NOTE : HEART
      return floating(love, 238, frame, 0) + floating(love, 290, frame, 5, 1.7)
    }
    case 'groom':
      if (species === 'dog') return at(240, 172, BONE)
      if (species === 'pikachu') return at(40 + (frame % 2) * 4, 120, SPARKS, 1.7) + at(180 - (frame % 2) * 4, 120, `<g transform="scale(-1 1)">${SPARKS}</g>`, 1.7)
      if (species === 'mew') return floating(PSY, 236 + (frame % 3) * 8, frame, 0) + floating(PSY, 290 - (frame % 3) * 8, frame, 5)
      if (species === 'jigglypuff') return floating(NOTE, 238, frame, 0)
      if (species === 'togepi') return floating(SPARKLE, frame % 2 ? 232 : 246, frame, 0)
      if (species === 'raccoon') return at(212, 150 + (frame % 3) * 6, DROP) + at(236, 162 - (frame % 3) * 6, DROP)
      return floating(HEART, 238, frame, 0)
    case 'play': {
      const [x, y, bounce] = ballAt(frame)
      const spin = look.isRolling ? ` rotate(${(x * 4) % 360})` : ''
      return (
        `<ellipse cx="${x}" cy="${GROUND}" rx="${18 - bounce / 3}" ry="4" fill="#000" opacity=".25"/>` +
        `<g transform="translate(${x} ${y}) scale(1.7)${spin}">${look.ball(frame)}</g>`
      )
    }
    case 'busy':
    case 'frantic': {
      const jitter = frame % 2 ? 6 : 0
      let out = [60, 110, 160]
        .map(y => `<path d="M${4 + jitter} ${y + jitter / 2} H${34 + jitter}" stroke="#8a8a8a" stroke-width="4" stroke-linecap="round" opacity=".7"/>`)
        .join('')
      if (mood === 'frantic') {
        out += at(204, 70 + (frame % 2) * 4, DROP)
        out += at(244, 44 + (frame % 2) * 6, power ?? BANG, 1.6)
        if (power) out += at(300, 80 - (frame % 2) * 6, power)
      } else if (power && frame % 4 === 0) {
        out += at(240, 50, power)
      }
      return out
    }
    case 'startled':
      return at(240, 40, power ?? BANG, 1.7) + (power ? at(292, 70, power, 1.3) : '')
    case 'happy':
      return (
        at(frame % 2 ? 228 : 246, 36, SPARKLE, 1.2) +
        at(frame % 2 ? 300 : 284, 96, SPARKLE) +
        at(20, frame % 2 ? 40 : 56, SPARKLE, 0.8)
      )
    case 'perk':
      return at(234, 44, QUESTION, 1.6)
    default:
      return ''
  }
}

// ---------------------------------------------------------------- the scene

function eyeStyle(mood: Mood, frame: number): EyeStyle {
  switch (mood) {
    case 'sleep':
      return 'closed'
    case 'purr':
    case 'happy':
      return 'happy'
    case 'groom':
      return frame % 4 < 2 ? 'closed' : 'happy'
    case 'frantic':
    case 'startled':
    case 'perk':
      return 'wide'
    case 'watch':
      return Math.floor(frame / 3) % 2 ? 'right' : 'open'
    case 'play':
      return frame % 16 < 8 ? 'right' : 'open'
    default:
      return frame % 8 === 7 ? 'closed' : 'open'
  }
}

function bobFor(look: Look, mood: Mood, frame: number) {
  let bob = 0
  if (mood === 'busy' || mood === 'frantic') bob = frame % 2 ? 4 : 0
  else if (mood === 'sleep') bob = Math.floor(frame / 4) % 2 ? 2 : 0
  else if (mood === 'startled' || mood === 'happy') bob = frame % 2 ? 0 : -8
  else if (mood === 'play') bob = ballAt(frame)[0] < 290 ? -6 : 0
  if (look.floats && mood !== 'sleep') bob += -14 + Math.sin(frame * 0.8) * 6
  return n(bob)
}

/** The pet as a vector drawing, one frame of its current mood. */
export function vectorSvg(species: Species, mood: Mood, frame: number): string {
  const look = LOOKS[species]
  let style = eyeStyle(mood, frame)
  if (look.sleepy && style !== 'wide' && style !== 'happy') style = 'closed'

  const pose: Pose = {
    mood,
    frame,
    eyes: style,
    isMouthOpen: mood === 'happy' || mood === 'startled' || mood === 'frantic',
    wag: mood === 'sleep' || mood === 'sit' ? 0 : [0, 10, 0, -10][frame % 4]!,
  }
  const bob = bobFor(look, mood, frame)
  const lean = mood === 'frantic' ? (frame % 2 ? 3 : -3) : mood === 'busy' ? 2 : 0
  const shadow = look.floats
    ? `<ellipse cx="${CX}" cy="${GROUND}" rx="${n(34 + bob / 2)}" ry="5" fill="#000" opacity=".18"/>`
    : `<ellipse cx="${CX}" cy="${GROUND}" rx="62" ry="7" fill="#000" opacity=".28"/>`

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}">` +
    `<defs>${gradient(look.fur)}</defs>` +
    shadow +
    `<g transform="translate(0 ${bob}) rotate(${lean} ${CX} ${GROUND})">${look.draw(pose)}</g>` +
    effects(species, look, mood, frame) +
    `</svg>`
  // Ids per species, so drawings placed in one document never share a gradient.
  return svg.replaceAll('url(#fur)', `url(#fur-${species})`).replace('id="fur"', `id="fur-${species}"`)
}
