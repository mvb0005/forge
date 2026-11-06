import { useEffect, useRef, useState } from 'react'
import type { ClientMessage, PlayerDto } from '../protocol'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { useForge, NO_IDS } from '../store'

export type PassChoice = { label: string; msg: ClientMessage }

/**
 * The "pass until …" choices for now: the engine decides when each one ends (docs/AUTOPASS.md); this only lists them.
 * Opponents' end steps in turn order from you; "the stack resolves" only with something on it.
 */
export function passChoices(players: Record<number, PlayerDto>, mine: number[], turnOrder: number[] | undefined, stackSize: number): PassChoice[] {
  const order = turnOrder?.length ? turnOrder : Object.keys(players).map(Number)
  const me = order.findIndex((id) => mine.includes(id))
  const after = me < 0 ? order : [...order.slice(me + 1), ...order.slice(0, me)]
  const out: PassChoice[] = []
  if (stackSize > 0) out.push({ label: 'Until the stack resolves', msg: { t: 'yield', kind: 'stack' } })
  out.push({ label: 'Until end of turn', msg: { t: 'yield', kind: 'turn' } })
  for (const id of after) {
    const p = players[id]
    if (p && !p.hasLost && !mine.includes(id)) out.push({ label: `Until ${p.name}’s end step`, msg: { t: 'yield', kind: 'endStep', playerId: id } })
  }
  out.push({ label: 'Until my next turn', msg: { t: 'yield', kind: 'nextTurn' } })
  return out
}

const small = { border: '1px solid rgb(239 228 204 / .4)', borderRadius: 3, background: 'transparent', color: 'var(--lk-parchment)', cursor: 'pointer', fontSize: 12, padding: '2px 8px' } as const

/**
 * Beside the pass button: while passing, what you wait for and Stop; otherwise a small "Pass until…" menu (tap, no
 * hover, so it works in the Discord Activity). Shown only when the server has the `autopass` cap.
 */
export function PassMenu() {
  const can = useForge((s) => s.caps.includes('autopass') && !!s.game && s.game.localPlayerIds.length > 0 && !s.game.gameOver)
  const auto = useForge((s) => s.autopass)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // A yield that ended early points at what stopped it, as a cancelled pass ahead does.
  useEffect(() => {
    const id = auto.stackId
    if (!auto.stopped || id == null) return
    useBoardUi.getState().setHoverStack(id)
    const t = setTimeout(() => {
      if (useBoardUi.getState().hoverStackId === id) useBoardUi.getState().setHoverStack(null)
    }, 3500)
    return () => clearTimeout(t)
  }, [auto.stopped, auto.stackId])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node && root.current?.contains(e.target))) setOpen(false)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
    }
  }, [open])

  if (!can) return null
  if (auto.yield) {
    return (
      <div className="lk-text" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '0 10px', borderRadius: 3, border: '1px solid var(--lk-gold-soft)', fontSize: 13 }}>
        <span aria-hidden style={{ color: 'var(--lk-gold)' }}>⏩</span>
        <span style={{ color: 'var(--lk-parchment)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={auto.yield.label}>{auto.yield.label}</span>
        <button type="button" onClick={() => send({ t: 'unyield' })} style={small}>Stop</button>
      </div>
    )
  }
  const choose = (m: ClientMessage) => {
    setOpen(false)
    send(m)
  }
  return (
    <div ref={root} style={{ position: 'relative' }}>
      {open && <PassList onChoose={choose} hold={auto.hold} />}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lk-title"
        title="Let the server pass priority for you until something you choose"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', minHeight: 28, padding: '0 12px', borderRadius: 3, cursor: 'pointer', fontWeight: 600, fontSize: 13, letterSpacing: '0.03em', color: 'var(--lk-parchment-dim)', background: 'transparent', border: '1px solid rgb(239 228 204 / .22)' }}>
        Pass until… <span aria-hidden style={{ fontSize: 10 }}>{open ? '▼' : '▲'}</span>
      </button>
    </div>
  )
}

function PassList({ onChoose, hold }: { onChoose: (m: ClientMessage) => void; hold: boolean }) {
  const players = useForge((s) => s.players)
  const mine = useForge((s) => s.game?.localPlayerIds ?? NO_IDS)
  const order = useForge((s) => s.game?.turnOrder)
  const stackSize = useForge((s) => s.stack.length)
  const choices = passChoices(players, mine, order, stackSize)
  const item = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', minHeight: 34, background: 'transparent', border: 0, color: 'var(--lk-parchment)', cursor: 'pointer', fontSize: 13.5 } as const
  return (
    <div role="menu" className="lk-text bf-pop" style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)', zIndex: 30, borderRadius: 4, padding: '4px 0', background: 'var(--lk-panel)', boxShadow: '0 0 0 1px var(--lk-metal-line), 0 8px 24px rgb(0 0 0 / .45)' }}>
      {choices.map((c) => (
        <button key={c.label} type="button" role="menuitem" onClick={() => onChoose(c.msg)} style={item}>{c.label}</button>
      ))}
      <div style={{ height: 1, margin: '4px 10px', background: 'var(--lk-metal-line)' }} />
      <label style={{ ...item, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--lk-parchment-dim)', fontSize: 12.5 }}
        title="After you cast a spell or activate an ability, be asked again with it on top (to respond to yourself)">
        <input type="checkbox" checked={hold} onChange={(e) => onChoose({ t: 'holdPriority', on: e.target.checked })} />
        Hold priority after my spells
      </label>
    </div>
  )
}
