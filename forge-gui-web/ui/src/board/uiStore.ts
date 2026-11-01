import { create } from 'zustand'

// Board-only UI state (never sent to the server).
type BoardUi = {
  focus: { playerId: number; turn: number } | null // multiplayer: opponent the user clicked, for this turn
  hoverStackId: number | null
  zoneView: { playerId: number; zone: 'graveyard' | 'exile' | 'command' | 'hand' } | null
  settled: number // bumped when card animations have landed (Arrows re-measure then, never mid-flight)
  handOrder: number[] | null // null: the hand is shown in mana-value order
  openLands: number[] // players whose land shelf is opened onto their battlefield
  setFocus: (playerId: number, turn: number) => void
  setHoverStack: (id: number | null) => void
  setZoneView: (z: BoardUi['zoneView']) => void
  setHandOrder: (ids: number[] | null) => void
  toggleLands: (playerId: number) => void
}

export const useBoardUi = create<BoardUi>()((set) => ({
  focus: null,
  hoverStackId: null,
  zoneView: null,
  settled: 0,
  handOrder: null,
  openLands: [],
  setFocus: (playerId, turn) => set({ focus: { playerId, turn } }),
  setHoverStack: (hoverStackId) => set({ hoverStackId }),
  setZoneView: (zoneView) => set({ zoneView }),
  setHandOrder: (handOrder) => set({ handOrder }),
  toggleLands: (id) => set((s) => ({ openLands: s.openLands.includes(id) ? s.openLands.filter((x) => x !== id) : [...s.openLands, id] })),
}))
