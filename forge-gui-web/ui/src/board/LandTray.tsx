import { memo } from 'react'
import { ManaSymbol } from '../look/ManaSymbol'
import { usePeek } from '../popover/usePeek'
import { SHELF, shelfColumns, shelfRows, shelfWidth, type TrayGroup } from './lands'

const FILL: Record<string, string> = {
  W: 'var(--lk-mana-w)', U: 'var(--lk-mana-u)', B: 'var(--lk-mana-b)', R: 'var(--lk-mana-r)', G: 'var(--lk-mana-g)', C: 'var(--lk-mana-c)',
}

/**
 * A player's lands on a shelf at the right end of their battlefield: the open-mana count, then one row per
 * stack (lands that make the same mana, or a named land or rock) with untapped/total. A stack with nothing
 * untapped lies sideways and fades. `glow`: stacks you can use now (frost). `opened`: the lands are drawn on
 * the battlefield; the toggle under the count opens and folds them. Clicking a stack picks a land in it.
 * `w`, `h`: the region the layout carved for it; when it is narrower than the names need, they are dropped.
 */
export const LandTray = memo(function LandTray({ groups, w, h, open, glow, opened, onToggle, onPick }: {
  groups: TrayGroup[]
  w: number
  h: number
  open: number
  glow?: (g: TrayGroup) => boolean
  opened?: boolean
  onToggle?: () => void
  onPick?: (ids: number[]) => void
}) {
  if (!groups.length) return null
  const rows = Math.min(shelfRows(h), groups.length)
  const tight = w < shelfWidth(groups, h) - 0.5
  const cols = shelfColumns(groups, h, tight)
  return (
    <div
      style={{
        display: 'flex', alignItems: 'stretch', padding: SHELF.pad, borderRadius: 8, boxSizing: 'border-box', maxWidth: '100%', maxHeight: '100%', overflow: 'hidden',
        background: 'linear-gradient(rgb(38 33 27 / .82), rgb(10 8 6 / .86))',
        boxShadow: '0 0 0 1px var(--lk-metal-line), inset 0 1px 0 rgb(255 236 200 / .07), 0 6px 14px rgb(0 0 0 / .45)',
      }}
    >
      <div style={{ width: SHELF.head, boxSizing: 'border-box', flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRight: '1px solid var(--lk-metal-faint)', marginRight: SHELF.colGap, paddingRight: 2 }}>
        <b className="lk-title" title={`${open} mana open`} style={{ fontSize: 24, fontWeight: 700, lineHeight: 0.9, color: open ? 'var(--lk-parchment)' : 'var(--lk-parchment-mute)', fontVariantNumeric: 'tabular-nums' }}>{open}</b>
        <span className="lk-text" style={{ fontSize: 9, color: 'var(--lk-parchment-mute)', letterSpacing: 0.4 }}>open</span>
        {onToggle && shelfRows(h) > 1 && (
          <button
            type="button"
            title={opened ? 'Fold the lands back onto the shelf' : 'Show the lands on the battlefield'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="lk-title"
            style={{ marginTop: 3, padding: '1px 6px', border: 0, borderRadius: 999, cursor: 'pointer', fontSize: 11, lineHeight: 1.3, background: opened ? 'var(--lk-brass)' : 'rgb(216 180 90 / .14)', color: opened ? 'var(--lk-on-parchment)' : 'var(--lk-parchment-dim)', boxShadow: '0 0 0 1px var(--lk-metal-line)' }}
          >
            {opened ? 'Fold' : 'Show'}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: `repeat(${rows}, ${SHELF.rowH}px)`, gridTemplateColumns: cols.map((w) => `${w}px`).join(' '), rowGap: SHELF.gap, columnGap: SHELF.colGap, alignContent: 'center' }}>
        {groups.map((g) => <Stack key={g.key} g={g} named={!tight} glow={!!glow?.(g)} onPick={onPick} />)}
      </div>
    </div>
  )
})

function Stack({ g, named, glow, onPick }: { g: TrayGroup; named: boolean; glow: boolean; onPick?: (ids: number[]) => void }) {
  const ids = [...g.open, ...g.tapped]
  const peek = usePeek({ kind: 'card', id: ids[0] })
  const n = g.open.length
  const total = ids.length
  return (
    <span
      {...peek}
      className="lk-fade"
      title={`${g.name ?? g.sym}: ${n} of ${total} untapped`}
      onClick={onPick ? (e) => {
        e.stopPropagation()
        onPick(n ? g.open : g.tapped)
      } : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, opacity: n ? 1 : 0.45, cursor: onPick ? 'pointer' : undefined }}
    >
      <Tile sym={g.sym} stacked={total > 1} tapped={!n} glow={glow && n > 0} />
      <b className="lk-title" style={{ flex: 'none', fontSize: 18, fontWeight: 700, lineHeight: 1, color: 'var(--lk-parchment)', fontVariantNumeric: 'tabular-nums' }}>
        {n}
        {n !== total && <span style={{ fontSize: '0.62em', color: 'var(--lk-parchment-mute)', fontWeight: 500 }}>/{total}</span>}
      </b>
      {g.name && named && (
        <span className="lk-text" style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--lk-parchment-dim)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
      )}
    </span>
  )
}

const TW = 20
const TH = 27

/** A land in miniature: a card-shaped tile in the mana's tone with its symbol. Several stack with an edge showing; a tapped-out stack lies sideways. */
function Tile({ sym, stacked, tapped, glow }: { sym: string; stacked: boolean; tapped: boolean; glow: boolean }) {
  const tone = FILL[sym[0]] ?? FILL.C
  const face = (style: React.CSSProperties) => ({
    position: 'absolute' as const, width: TW, height: TH, borderRadius: 3, boxSizing: 'border-box' as const,
    background: `linear-gradient(color-mix(in srgb, ${tone} 38%, #17120d), color-mix(in srgb, ${tone} 12%, #0e0b08))`,
    ...style,
  })
  return (
    <span style={{ position: 'relative', flex: 'none', width: TH, height: TH, transform: tapped ? 'rotate(90deg)' : undefined }}>
      {stacked && <span style={face({ left: (TH - TW) / 2 + 3, top: -1, boxShadow: '0 0 0 1px var(--lk-ink), 0 0 0 1.5px var(--lk-metal-faint)' })} />}
      <span style={{ ...face({ left: (TH - TW) / 2, top: 0 }), display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1px var(--lk-ink), 0 0 0 2px var(--lk-metal-line), 0 2px 4px rgb(0 0 0 / .5)' }}>
        <ManaSymbol sym={sym} size={15} shadow={false} />
      </span>
      {glow && <span className="lk-glow" style={{ ...face({ left: (TH - TW) / 2, top: 0 }), background: 'none', boxShadow: '0 0 0 1.5px var(--lk-frost), 0 0 9px 1px var(--lk-frost-soft)' }} />}
    </span>
  )
}
