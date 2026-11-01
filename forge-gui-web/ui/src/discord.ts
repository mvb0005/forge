import { useForge } from './store'

// Inside the Discord Activity (mtgtracker/discord) the table opens in a frame over the lobby, which keeps
// Discord's connection (another page can't make it again): the lobby says who is talking in the voice channel
// (postMessage `forge-speaking`, Discord user ids), and closes the frame when the table asks (`forge-back`).
// Discord pictures load through the Activity's proxy. Outside Discord none of this applies.

export const inDiscord = (() => {
  try {
    return location.hostname.endsWith('.discordsays.com')
  } catch {
    return false
  }
})()

/** The table is in the lobby's frame (same origin), not a page of its own. */
export const inLobby = (() => {
  try {
    return inDiscord && window.parent !== window && window.parent.location.origin === location.origin
  } catch {
    return false
  }
})()

/** A picture URL the page can load: Discord's CDN goes through the Activity's /cdn mapping inside Discord. */
export function faceUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (inDiscord && url.startsWith('https://cdn.discordapp.com/')) return `/.proxy/cdn/${url.slice('https://cdn.discordapp.com/'.length)}`
  return url
}

/** Back to where the game came from: the lobby closes its frame, or the page goes to `url`. */
export function goBack(url: string | null) {
  if (inLobby) window.parent.postMessage({ type: 'forge-back' }, location.origin)
  else if (url) location.href = url
}

/** Who is talking, from the lobby. */
export function listenForVoice() {
  if (!inLobby) return
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'forge-speaking') return
    const ids: unknown = e.data.ids
    if (Array.isArray(ids)) useForge.setState({ speaking: new Set(ids.map(String)) })
  })
  window.parent.postMessage({ type: 'forge-hello' }, location.origin)
}
