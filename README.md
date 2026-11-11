# Matchday Legends

An original browser football-manager game built around a **daily session**: one matchday per real day,
10 to 30 minutes of play, and fully animated matches.

## Run it
No build step is needed for development. Serve the folder with any static server and open `index.html`:

    python3 -m http.server 8000   # then open http://localhost:8000

To produce single-file builds (`dist/index.html` for hosting, `dist/artifact.html` for a preview page):

    npm i -g esbuild@0.24.0 && node build.mjs esbuild

## The daily loop
- Each real day unlocks one league matchday (12-club leagues, 22 matchdays, about 3 weeks per season).
- Daily session: morning briefing, one training session, team and tactics, the match (watch live with
  half-time changes, or take a quick result), transfer bids and scouting that resolve overnight.
- Missing a day: the assistant plays the match with your last tactics. Training for that day is lost,
  offers lapse, and the login streak resets.
- Streaks pay a growing sponsor bonus; three daily objectives pay small cash rewards.
- Multi-day projects: stadium expansions, training ground and academy upgrades. Weekly academy prospects.
- Two divisions with promotion and relegation, season review, board target and confidence.

## Code map
| Path | What it does |
| --- | --- |
| `js/core/rng.js` | Seeded, serializable RNG |
| `js/core/world.js` | World generation, fixtures, league table |
| `js/core/players.js` | Players, attributes, values, wages, lineups |
| `js/core/sim.js` | Statistical match engine: team sheets in, full event timeline out |
| `js/core/game.js` | Rules: day clock, matchdays, training, transfers, season end, `dispatch(state, command)` |
| `js/core/finance.js` | Gate receipts, sponsors, TV money, wages, prize money |
| `js/match/view.js` | Canvas match renderer: plays back the sim timeline as a live broadcast |
| `js/match/audio.js` | Synthesized crowd, whistle and kick sounds (no audio files) |
| `js/ui/pack.js` | Local-only name packs: overlay, export, sanitized import |
| `js/ads.js` | Ad slots. Fill in AdSense IDs to replace the placeholders |
| `js/main.js` | UI screens, match flow, persistence, shared-league client (`#hub=` only) |
| `js/server/league.js` | Shared league for the game hub: per-manager state, command checks, views |

## Multiplayer-ready decisions
- **Pure, serializable state.** The whole career is one JSON object; nothing lives in closures.
- **Commands.** Every manager action goes through `dispatch(state, { type, clubId, ... })`. A server can
  validate the same commands for many human clubs (`state.humans` is already a list).
- **Deterministic simulation.** Match results come from `simulateMatch(sheets, seed)`, so a server can run
  them and clients only animate the timeline.
- **Swappable clock.** `syncClock()` takes the current time; a server can own the calendar instead.
- **Name packs never touch shared state.** They are a per-browser overlay, so in multiplayer other
  managers always see the default fictional names.

## Shared leagues (multiplayer)
Opened from the game hub's lobby with `#hub=<hub>&room=<code>&token=...`, the game joins a shared league
instead of the local career. Without that fragment nothing changes: no network calls, same save.
- `js/server/league.js` is the league server module. The hub (rocketframe/game-hub) copies `js/core` and
  `js/server` with `scripts/sync-bmp.sh` and runs every rule on the server, so browsers only send commands.
- Per-manager parts (today, objectives, inbox, history, streak, scouting) live in `state.mgrs[clubId]`.
  Single player has no `state.mgrs` and keeps them on the state itself, so old saves load unchanged.
- The browser only accepts hubs listed in `HUB_ORIGINS` in `js/config.js` (and a localhost hub while the
  game is served from localhost). It lists the production and staging hubs.
- Tests: `node --test test/*.test.mjs`.

## Before a public launch
- Set `DEV_TOOLS = false` in `js/config.js` (it enables "skip to tomorrow").
- Add AdSense IDs in `js/ads.js`, publish `ads.txt`, and add a Google-certified consent banner (EU/UK).
- Have a lawyer review the terms and disclaimer text (`#legal` screen).

## Real movement in match highlights
`js/match/real-data.js` holds 37 real attacks that end in a shot, traced from the public Metrica Sports sample tracking data (two anonymised matches, 25 Hz). The extractor normalises each move to attack right, keeps up to 9 s of build-up, and stores 5 keyframes per second. `MatchView.setupReal` maps our players onto the real tracks by position, with the shooter and assist pinned to the real shooter and passer, and the shot outcome (goal, save, miss) is animated by the game. Metrica asks for credit when the data is used publicly (see #legal). Before launch, confirm with Metrica that commercial use is fine, or swap in MIT-licensed SkillCorner open data.

## 3D match renderer
`js/match/view3d.js` draws the match in WebGL with three.js (vendored at `js/vendor/three.module.min.js`, MIT, see `three-LICENSE.txt`). `MatchView` still runs the whole match and feeds the renderer each frame: player positions, headings, poses and the ball. Players are procedural low-poly figures with code-driven running, kicking, heading, diving and celebration animations. The camera works like a TV director: a main camera on the halfway line that pans and zooms, a push-in as attacks reach the box, and replays from a high camera behind the attack, cutting to behind the goal for the finish. The 2D canvas stays on top for overlays (labels, radar, interlude clock, replay wipe). If WebGL is not available, the old 2D renderer is used (`new MatchView(canvas, { three: false })` forces it).

## Crowd sound
`js/match/audio.js` synthesizes the crowd in the browser from many detuned vocal oscillators shaped by vowel formants, rendered once into loops and one-shots: murmur and excited beds, a rising "ooh" when a shot is struck, a goal roar with claps and whistles, a groan, applause and an original clap-along chant. Real recordings (for example from Pixabay, whose licence allows use in games) would sound better and can replace these buffers.
