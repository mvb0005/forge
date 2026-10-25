import { create } from 'zustand'

// Board-only UI state (never sent to the server).
type BoardUi = {
  focus: { playerId: number; turn: number } | null // multiplayer: opponent the user clicked, for this turn
  hoverStackId: number | null
  zoneView: { playerId: number; zone: 'graveyard' | 'exile' | 'command' | 'hand' } | null
  settled: number // bumped when card animations have landed (Arrows re-measure then, never mid-flight)
  setFocus: (playerId: number, turn: number) => void
  setHoverStack: (id: number | null) => void
  setZoneView: (z: BoardUi['zoneView']) => void
}

export const useBoardUi = create<BoardUi>()((set) => ({
  focus: null,
  hoverStackId: null,
  zoneView: null,
  settled: 0,
  setFocus: (playerId, turn) => set({ focus: { playerId, turn } }),
  setHoverStack: (hoverStackId) => set({ hoverStackId }),
  setZoneView: (zoneView) => set({ zoneView }),
}))
