import { CARD_RATIO } from './layout'
import type { LayoutResult } from '../table/contract'
import { useForge } from '../store'

/** The ring that opens across the middle. Attackers step into it; blockers join them when assigned. */
export function Arena({ layout }: { layout: LayoutResult }) {
  const bands = useForge((s) => s.combat?.bands)
  if (!bands?.length) return null
  // 3-4 players: each fight is in the attacked player's band, with its own ring.
  const fights = Object.entries(layout.regions).filter(([k]) => k.startsWith('engage:'))
  if (fights.length) {
    return (
      <>
        {fights.map(([k, r]) => (
          <div key={k} className="pointer-events-none"
            style={{ position: 'absolute', left: r.x - 4, top: r.y - 2, width: r.w + 12, height: r.h + 4, zIndex: 1, borderRadius: 14, background: 'rgb(0 0 0 / .18)', boxShadow: 'inset 0 0 0 1.5px var(--lk-ember-line)' }} />
        ))}
      </>
    )
  }
  const splitY = layout.regions.split?.y
  if (splitY == null) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let n = 0
  for (const band of bands) {
    for (const id of [...band.attackerIds, ...band.blockerIds, ...band.plannedBlockerIds]) {
      const p = layout.placements.get(id)
      if (!p || p.opacity === 0) continue
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x + p.w)
      y1 = Math.max(y1, p.y + p.w * CARD_RATIO)
      n++
    }
  }
  if (!n) return null
  // A fight that crosses the seam opens across it. Otherwise the ring stays on the cards.
  const crosses = y0 < splitY && y1 > splitY
  const top = (crosses ? Math.min(y0, splitY) : y0) - 26
  const bot = (crosses ? Math.max(y1, splitY) : y1) + 32
  const left = x0 - 28
  const width = x1 - x0 + 56
  const height = bot - top
  return (
    <div
      className="pointer-events-none"
      style={{
        position: 'absolute', left, top, width, height, zIndex: 1,
        borderRadius: Math.min(36, height / 2),
        background: 'rgb(0 0 0 / .16)',
        boxShadow: 'inset 0 0 0 1.5px rgb(242 234 214 / .5)',
      }}
    />
  )
}
