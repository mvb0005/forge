import { useForge } from './store'

// Inside the Discord Activity (mtgtracker/discord): who is talking in the voice channel, by Discord user id,
// and Discord pictures through the Activity's proxy. The lobby opens the table with Discord's launch query
// (frame_id, instance_id, ...) plus `app` (the application's client id), which the SDK needs; outside Discord
// none of this runs.

export const inDiscord = (() => {
  try {
    return window.parent !== window && new URLSearchParams(location.search).has('frame_id')
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

/** Where "back" goes: inside Discord the lobby needs Discord's launch query again (minus the table's own params). */
export function backUrl(url: string | null): string | null {
  if (!url || !inDiscord || !url.startsWith('/') || url.includes('?')) return url
  const q = new URLSearchParams(location.search)
  q.delete('ticket')
  q.delete('app')
  return `${url}?${q}`
}

/** One line in the tracker's log per step of the voice setup: the Activity's console is out of sight. */
function trace(step: string, detail = '') {
  try {
    void fetch('/.proxy/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, detail }) })
  } catch {
    // nothing to do
  }
}

/** Signs in to Discord again, asking for voice too, and follows who is speaking. */
export async function listenForVoice() {
  const inFrame = (() => {
    try {
      return window.parent !== window
    } catch {
      return true
    }
  })()
  if (!inDiscord) {
    if (inFrame) trace('not started', `no frame_id in ${location.search.slice(0, 120)}`)
    return
  }
  const clientId = new URLSearchParams(location.search).get('app')
  if (!clientId) return trace('not started', 'no app id')
  trace('start')
  try {
    const { DiscordSDK, Events } = await import('@discord/embedded-app-sdk')
    const sdk = new DiscordSDK(clientId)
    await sdk.ready()
    trace('ready', `channel ${sdk.channelId ?? 'none'}`)
    // Voice is asked for here, not in the lobby: Discord shows its consent prompt the first time (it won't
    // grant this scope silently), and a refusal only means no rings.
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      scope: ['identify', 'guilds.members.read', 'rpc.voice.read'],
    })
    trace('authorized')
    const res = await fetch('/.proxy/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    if (!res.ok) return trace('session refused', String(res.status))
    const { accessToken } = await res.json()
    await sdk.commands.authenticate({ access_token: accessToken })
    trace('authenticated')
    if (!sdk.channelId) return trace('no channel')
    const set = (id: string, on: boolean) =>
      useForge.setState((s) => {
        const speaking = new Set(s.speaking)
        if (on) speaking.add(id)
        else speaking.delete(id)
        return { speaking }
      })
    await sdk.subscribe(Events.SPEAKING_START, (e: { user_id: string }) => set(e.user_id, true), { channel_id: sdk.channelId })
    await sdk.subscribe(Events.SPEAKING_STOP, (e: { user_id: string }) => set(e.user_id, false), { channel_id: sdk.channelId })
    trace('listening', `channel ${sdk.channelId}`)
  } catch (e) {
    trace('failed', e instanceof Error ? e.message : JSON.stringify(e))
  }
}
