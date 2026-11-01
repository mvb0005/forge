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

/** Signs in to Discord again (silently: the lobby already asked) and follows who is speaking. */
export async function listenForVoice() {
  if (!inDiscord) return
  const clientId = new URLSearchParams(location.search).get('app')
  if (!clientId) return
  try {
    const { DiscordSDK, Events } = await import('@discord/embedded-app-sdk')
    const sdk = new DiscordSDK(clientId)
    await sdk.ready()
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'guilds.members.read', 'rpc.voice.read'],
    })
    const res = await fetch('/.proxy/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    if (!res.ok) return
    const { accessToken } = await res.json()
    await sdk.commands.authenticate({ access_token: accessToken })
    if (!sdk.channelId) return
    const set = (id: string, on: boolean) =>
      useForge.setState((s) => {
        const speaking = new Set(s.speaking)
        if (on) speaking.add(id)
        else speaking.delete(id)
        return { speaking }
      })
    await sdk.subscribe(Events.SPEAKING_START, (e: { user_id: string }) => set(e.user_id, true), { channel_id: sdk.channelId })
    await sdk.subscribe(Events.SPEAKING_STOP, (e: { user_id: string }) => set(e.user_id, false), { channel_id: sdk.channelId })
  } catch (e) {
    console.warn('Discord voice unavailable', e) // a text channel launch, or no voice permission: no rings
  }
}
