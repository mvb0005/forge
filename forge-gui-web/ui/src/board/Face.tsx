import { faceUrl } from '../discord'
import type { PlayerDto } from '../protocol'
import { useForge } from '../store'

// A player's face on their border: their Discord picture, or for an AI a sigil in their colours. While they
// talk in the Activity's voice channel the ring goes green.

const EDGE: Record<string, string> = { W: '#e8dcb5', U: '#4f86c6', B: '#6b5a7c', R: '#c4532f', G: '#4e8a52', C: '#8e8a82' }

export function Face({ player: p, colors, size }: { player: PlayerDto; colors: string; size: number }) {
  const talking = useForge((s) => !!p.discordId && s.speaking.has(p.discordId))
  const src = faceUrl(p.discordId ? p.avatarImg : null)
  const ring = talking ? '0 0 0 2px #3ba55d, 0 0 10px 2px rgb(59 165 93 / .75)' : '0 0 0 1.5px var(--lk-metal-line)'
  return (
    <span aria-hidden title={talking ? `${p.name} is talking` : undefined}
      className={talking ? 'face-talking' : undefined}
      style={{ width: size, height: size, borderRadius: 99, flex: 'none', overflow: 'hidden', boxShadow: ring, background: '#14100c', display: 'inline-flex', transition: 'box-shadow 120ms' }}>
      {src ? <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} draggable={false} /> : <Sigil colors={colors} size={size} ai={p.isAI} />}
    </span>
  )
}

/** A generic face: a planeswalker-ish sigil over the player's colours (a cog for an AI). */
function Sigil({ colors, size, ai }: { colors: string; size: number; ai: boolean }) {
  const cs = (colors || 'C').split('')
  const stops = cs.map((c, i) => <stop key={i} offset={cs.length === 1 ? 0 : i / (cs.length - 1)} stopColor={EDGE[c] ?? EDGE.C} />)
  const id = `sig-${cs.join('')}`
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${id})`} opacity="0.55" />
      {ai ? (
        <g fill="none" stroke="#f2ead6" strokeWidth="1.8" strokeLinejoin="round">
          <circle cx="16" cy="16" r="4.2" />
          <path d="M16 6.5v3.2M16 22.3v3.2M6.5 16h3.2M22.3 16h3.2M9.3 9.3l2.3 2.3M20.4 20.4l2.3 2.3M9.3 22.7l2.3-2.3M20.4 11.6l2.3-2.3" strokeLinecap="round" />
        </g>
      ) : (
        <path d="M16 6l3 7 7 .6-5.3 4.6 1.6 7L16 21.5l-6.3 3.7 1.6-7L6 13.6l7-.6z" fill="#f2ead6" opacity="0.9" />
      )}
    </svg>
  )
}
