import { useLayoutEffect, useState } from 'react'
import { MatchTable } from '../../board/MatchTable'
import { PeekRoot } from '../../popover/PeekRoot'
import type { CardDto } from '../../protocol'
import { PromptBar } from '../../shell/PromptBar'
import { useForge } from '../../store'
import { artFor, SCENES } from './scenes'

// Dev only: /?look=live&scene=main|combat|four|… drives the real table (MatchTable, card layer, chrome)
// from a mockup scene, with the mockup art, so the live table can be set beside the approved mockups.

export function LiveScene() {
  const name = new URLSearchParams(location.search).get('scene') ?? 'main'
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const sc = SCENES[name]?.make()
    if (!sc) return
    const s = sc.state
    const cards: Record<number, CardDto> = {}
    for (const c of Object.values(s.cards ?? {})) cards[c.id] = { ...c, img: artFor(c.name) ?? c.img, basePower: sc.base[c.id]?.power, baseToughness: sc.base[c.id]?.toughness }
    const players = Object.fromEntries(Object.entries(s.players ?? {}).map(([id, p]) => [id, { ...p, colorIdentity: [...(sc.colors[+id] ?? '')] }]))
    const highlighted = new Set(s.highlighted ?? [])
    if (sc.focusAttacker != null) highlighted.add(`card:${sc.focusAttacker}`)
    const combat = s.game?.phase === 'COMBAT_DECLARE_BLOCKERS'
    useForge.setState({
      inMatch: true, connected: false, ask: null, reveal: null, notices: [], gameOver: null, ...s, cards, players, highlighted,
      prompt: { playerId: 1, message: sc.hint ?? '', cardId: null },
      buttons: { ok: { label: combat ? 'Confirm blocks' : s.game?.activePlayerId === 1 ? 'To combat' : 'OK', enabled: true }, cancel: { label: combat ? '' : 'End turn', enabled: !combat }, focusOk: true },
    })
    setReady(true)
  }, [name])
  if (!ready) return <p style={{ padding: 40 }}>Unknown scene.</p>
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <MatchTable centerSlot={<PromptBar />} />
      <PeekRoot />
    </div>
  )
}
