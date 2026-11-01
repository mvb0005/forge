# Forge web UI: Discord plan

Milestone M13. Same conventions as PLAN.md and MULTIPLAYER.md: milestones end playable, exit criteria
are the definition of done, D- are decisions, Q- are open questions. Builds on M11 (the tracker connects
people, a game server pod per game, D-M8 and D-M9).

## Goal

Friends in Matt's Discord server play Forge inside Discord: a **Discord Activity** launched from a voice
or text channel. Everyone in the same Activity instance shares one table, each in their own seat with a
deck from their tracker account, signed in by Discord (D-D3, Matt). No bot or slash commands first.

Matt already runs a test Activity, SweepTogether (`C:\code\SweepTogether`, docs/DISCORD_ACTIVITY.md):
Embedded App SDK, `authorize` then a server-side code exchange, URL mappings through Discord's proxy, one
room per `instanceId`. This plan reuses its patterns and the test application.

## How it fits the split (D-M8)

Discord is one more way into the tracker's play module, never the game server directly:

```
Discord client
  └─ Activity iframe: <app id>.discordsays.com, Discord's proxy
       ├─ /.proxy/                  ──> activity hostname ──> tracker: mtgtracker/discord/
       │                                                      (sign-in, lobby, start; calls play/)
       └─ /.proxy/play/table/<id>/  ──> activity hostname ──> forge router ──> table pod <id>
```

- **The tracker owns it:** a distinct module `mtgtracker/discord/`, beside `play/`. It signs people in
  through Discord, serves the Activity's lobby, and starts and joins tables through the play module, as
  the play page does.
- **The game server is unchanged** but for two things: the table page runs under Discord's `/.proxy/`
  prefix (it already uses relative URLs: vite `base: './'`, relative card images, the socket beside the
  page), and in the Activity it takes its seat ticket from the lobby, not the address bar.

## Signing in (D-D2)

1. **In the Activity:** the page calls the SDK's `authorize` (scope `identify`). The tracker exchanges
   the code with Discord using the application's secret, reads the user's id from `/users/@me`, and
   returns:
   - the access token, which the page passes to the SDK's `authenticate` (as SweepTogether does);
   - a short-lived Activity session token for the tracker's own calls (a bearer header: cookies are
     unreliable in Discord's iframe).
2. **Who that is:** a tracker person carries a Discord user id once linked. Linking happens on the
   tracker website, behind Access as now: "Link Discord" on the profile runs the same OAuth and stores
   the id. Only the Discord user id is kept.
3. **Unlinked Discord users:** Q-D2.

The code exchange is unauthenticated and spends the application's secret, so it is rate limited per
client (SweepTogether does the same) and accepts only a plausible code.

## Exposure

Today everything sits behind Cloudflare Access. Discord's proxy fetches the Activity from our origin
without an Access cookie, so the Activity needs a hostname outside Access (Q-D3):

- **One new hostname** on the same tunnel, with two routes: `/play/table/` to the forge router, and
  everything else to the tracker.
- **On that hostname the tracker serves only the discord module** (sign-in, lobby, its API) and
  refuses every other route. The rest of the tracker stays reachable only through Access.
- **The table pages are safe there as they are:** a page without a seat ticket shows nothing, and a
  ticket comes only from a signed-in lobby.
- **Secrets:** the application's client id and secret in a Kubernetes Secret `discord-activity` in
  `mtgtracker`, like `forge-control`.

## The Activity

- **One instance is one table.** Discord gives every participant the same `instanceId`. The tracker
  maps it to a table: the first to join makes it, later people take seats, and anyone past the seats
  watches (once spectating exists).
- **Lobby:** each person picks one of their decks, the host picks AI opponents for the empty seats and
  starts. Solo, that is today's goldfish game. With friends it needs M11.3 (several humans at a table).
- **Then the table:** the lobby hands the page its seat ticket and opens `play/table/<id>/`.
- **Participants:** names and avatars come from the SDK (`getInstanceConnectedParticipants`, as
  SweepTogether does), and avatars load through a `/cdn` URL mapping to `cdn.discordapp.com`.
- **Layout:** the Activity frame is smaller than a browser window, and phones are a big share of
  Discord. The table already has per-height layouts; the Activity's frame sizes join its layout tests.
- **Results and replays** land in the tracker as now, so they show in the person's history on the
  website.

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| M13.0 | **Spike** | The test application's Activity, launched in Matt's server, loads a page from our new hostname through Discord's proxy, signs in (code exchanged by the tracker, user id read), and holds a WebSocket to a table pod through the proxy for a few minutes. Settles Q-D3 | todo |
| M13.1 | **Link accounts** | "Link Discord" on the tracker profile stores the Discord user id on the person (a migration in the discord module); the people list shows who is linked; tests fake Discord's OAuth | todo |
| M13.2 | **Goldfish in Discord** | Launch the Activity, sign in, pick a deck and opponents, play a game to the end in the iframe on desktop and phone; the result and replay reach the tracker | todo |
| M13.3 | **Together** | Everyone in the instance shares the table: seats for linked people, AIs for the rest of the seats, a host who starts it. Needs M11.3 (several humans) and M11.4 (pause on disconnect: a sleeping phone shouldn't stall or lose the game) | todo |
| M13.4 | **Polish** | Participants' names and avatars at the table, a rejoin path after the Activity closes, the lobby in the Activity look | todo |

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-D1 | Discord reaches the play module through the tracker, never the game server directly; a distinct module `mtgtracker/discord/` | proposed |
| D-D2 | People are still tracker people; a Discord user links to one, and only the Discord user id is kept | proposed |
| D-D3 | An Activity from the start, signed in through Discord; no bot first | locked (Matt) |
| D-D4 | Only the Activity hostname is outside Access; there the tracker serves only the discord module, which authenticates by Discord | proposed |

## Questions

| ID | Question | Options and current lean | Blocks |
|---|---|---|---|
| Q-D2 | Can a Discord user with no tracker account play? | (a) No: they're told to ask Matt for access, then link; (b) yes, as a guest with precon decks and no history; (c) Discord sign-in makes them a tracker person (an account by Discord alone). Lean: (a) now, (b) later for friends of friends | M13.2 |
| Q-D3 | The Activity's hostname | A new subdomain on the same tunnel outside Access (e.g. `forge.mattbonsall.com`), or bypass paths on mtg.mattbonsall.com. Lean: a new subdomain, so nothing else of the tracker is reachable there | M13.0 |
| Q-D4 | Which servers | Matt's server only; the app stays private. Lean: yes; going public needs Discord's review and a different trust model | M13.0 |
| Q-D5 | The test application or a new one | Reuse SweepTogether's test app for the spike; make a "Forge" application once it works (its own name, icon and URL mappings) | M13.2 |

## Risks

- **Public surface.** For the first time, part of the tracker is reachable without Cloudflare Access.
  Keep it to the discord module, test that every other route is refused on that hostname, and rate
  limit the code exchange.
- **Discord's proxy.** WebSockets, the content security policy and URL mappings behave differently in
  the iframe than in a browser. M13.0 proves the table's socket through it before anything is built on
  that.
- **Mobile.** The table was built for desktop; Activities are used a lot on phones. Budget layout work
  in M13.2.
- **Discord's terms.** A private app in one server is fine. Distributing it, or anything commercial
  around card data, is a different question; not planned.
