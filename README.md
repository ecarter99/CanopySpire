# Canopy Spire — Multiplayer Web Prototype

A solarpunk, non-violent, co-op traversal game: climb, glide and grapple through a vertical city and restore its broken infrastructure. Built from `canopy_spire_prd_sdd_multiplayer_web_prototype.md` as a static, no-build web app in `public/`. Three.js r160 and PeerJS 1.5.4 are vendored in `public/vendor/`, along with three of Three.js's example add-ons (OutlineEffect, RoundedBoxGeometry, BufferGeometryUtils). The add-ons are unmodified except that their `'three'` import points at the local copy.

## Run
```bash
python3 -m http.server 8000 --directory public
# open http://localhost:8000
```
Serve **only** `public/`, both locally and when deploying, so `.git` and other repo files are never exposed. Opening the file directly (`file://`) isn't supported because the Content-Security-Policy and ES modules need a real origin.

To test from a second laptop on the same Wi-Fi, add `--bind 0.0.0.0`, then open `http://<your LAN IP>:8000` (find it with `hostname -I`). Stop the server when you're done, and don't do this on public Wi-Fi.

## Play online (GitHub Pages)
**https://ecarter99.github.io/CanopySpire/**

Every push to `main` that touches `public/` redeploys automatically (`.github/workflows/pages.yml`). Only `public/` is published. The repo is public, so its source and commit history are visible too. To invite friends directly into a room, share `https://ecarter99.github.io/CanopySpire/?room=CODE`.

## Multiplayer (2–4 players)
- One player clicks **Host Room** and shares the 5-letter code. Others enter it and click **Join Room**. `?room=CODE` in the URL pre-fills the code.
- Peer-to-peer via WebRTC. The public PeerJS cloud server only does signalling, so there is no server to run. The host is authoritative for node progress, pickups and chat. If the host leaves, clients continue solo with the world state they had.
- Some strict NAT/corporate networks block WebRTC. If joining times out, try another network.

## Controls
| Key | Action |
|---|---|
| WASD / Shift | Move / sprint |
| Space | Jump; press again in the air to glide |
| Walk into a wall | Climb (15 stamina/s). On a wall: Space = leap off, W+Space = dash up, X = let go |
| F / Right-click | Grapple to the targeted gold anchor ring |
| Q | Scanner: nodes, resources, thermals, dormant sky-lines |
| E | Inspect a node. In the panel: 1/2/3 deliver ⚡/🌱/⚙️, R = calibration minigame |
| Enter | Chat (emoji quick-buttons) |
| J | Quest log (talk to Keepers with E) |
| T | Track the next unrestored node (compass + on-screen waypoint) |
| G / Middle-click | Ping a spot for everyone ("⚡ here", node names…) |
| B then 1–4 | Emote: wave, cheer, dance, sit |
| E (at a sky-line post) | Ride the sky-line zipline |
| H | Help · mouse wheel = camera distance |
| Esc | Game menu: resume, copy invite link, leave to home screen |

## Look & graphics
- **Customize your character** on the home screen: outfit, accent, skin, hair, hat (none, straw, cap, flower crown, hood, beanie, goggles) and glider colour, with a live 3D preview. Your look is saved in this browser and shown to everyone in the room.
- **Graphics** (home screen or Esc menu):

  | Preset | Render scale | Shadows | Ink outlines | Grass |
  |---|---|---|---|---|
  | Low | 1x | 1024 | off | sparse |
  | Medium | up to 1.5x | 2048 | on | medium |
  | High (default) | 1.25–2x | 4096 | on | dense |
  | Ultra | 2–3x | 4096 | on | densest |

  Pick a lower preset if the fps counter (bottom-right) is low.
- Visuals are fully procedural:
  - generated stone, plaster, wood, paving, roof-tile and grass textures;
  - rounded geometry; four house styles; wind-blown grass that follows the player;
  - flowers that grow in as districts are restored.

  Static scenery is merged into a few large draw calls to keep it fast.

## Keepers, puzzles & portal realms
Three Keepers give a five-part quest chain. ❗ means they have a quest, ❓ means it's ready to turn in. Quests show in the tracker (top-left), the log (J) and on the compass.

| Quest | Keeper | What you do |
|---|---|---|
| The Songbird Stone | Mossa (by the spawn) | **Chime memory puzzle** in the west plaza: wake the Songbird Stone, then echo its melodies on five chime pillars. There are three rounds of 3/5/7 notes. Opens the **Sky portal**. |
| Two Hands, One Gate | Brindle (east) | **Pressure-plate vault:** hold all three plates at once, with friends standing on them or by carrying seed-stones (E to lift/set down). Then claim the key inside. Opens the **Grotto portal**. |
| Light in the Grotto | Aster (Portal Plaza, north) | **Crystal Grotto realm:** rotate seven mirrors so the sunbeam, split by a prism, lights *both* receivers. Take the Spirit Orb of Light. |
| Winds of the Archipelago | Aster | **Sky Archipelago realm:** a floating-island parkour trial using jumps, a bounce bloom, a thermal and a grapple chain to the summit shrine. Take the Spirit Orb of Wind. |
| The Keepers' Blessing | Mossa | Bring both orbs back to unlock the **Keeper's Circlet** hat and the **Starlight Glider**. |

- **Shared puzzle state:** puzzle progress and opened portals are shared world state, run by the host and saved with the host's spire, so friends can solve them together and follow through portals.
- **Per-player progress:** quest progress, Spirit Orbs and the cosmetic unlocks belong to each player.
- **Rewards:** each quest also grants restoration materials.

## Things to do besides restoring
- **Sky-lines:** four ziplines. Two run from the canopy deck down to the outskirts; two more, from the Apex Crown, start running once the Crown Wind Turbines are restored.
- **Bounce blooms:** land on the giant pink flowers to launch about 7 m up, then glide. One is active from the start; the rest sprout as each tier gets its first restoration.
- **12 Seed Relics:** hidden in hard-to-reach spots, such as above a bloom, behind the waterfall, on top of a turbine, or at the crown's peak. Finding 3, 6, 9 and 12 unlocks the Leaf crown hat, Rainbow glider, Sprout hat and Golden glider. Relics are per-browser and carry across worlds.
- **Glide-ring time trials:**
  - *Canopy Drop* starts at the canopy deck's south-east edge.
  - *Thermal Spiral* is around the western thermal and opens after the Geothermal Conduit is restored.

  Best times are saved, and finishing posts your time to the room chat.
- **Day & night:** about a 9-minute cycle, synced from the host. Expect sunsets, stars and a moon, warm window light, glowing lamps, and fireflies over restored meadows.
- **Wildlife:** butterflies gather at flowerbeds as districts bloom; flocks of birds circle the spire by day.
- **Sound:** fully procedural. Footsteps, glide wind, waterfalls, birdsong and crickets, and gentle generative music that grows richer as the spire is restored. Volume is on the home screen and in the Esc menu.

## Saving
Your spire saves automatically in this browser's localStorage: node progress, carried materials, and your last safe position. It saves every 10 s, after deliveries and restorations, when you open the menu, and when you leave or close the tab.
- **Play Solo** and **Host Room** continue from your save, so friends who join see your restored spire and help you progress it.
- **Joining** someone's room plays *their* spire. Your own save isn't touched, and your progress there is saved on the host's side.
- The home screen shows your save, with a **Start over** link to erase it. Saves are per-browser: a different browser or device starts fresh. The time of day is saved with your spire; relics and best times are kept separately.

## Loop
Collect ⚡ energy cells, 🌱 bio-materials and ⚙️ scrap. They respawn after 45 s and are shared, so whoever grabs one first gets it. Deliver them to the 7 restoration nodes, then run 3 calibrations, which anyone can contribute to. Each restored node visibly changes its district and opens access:

| Node | Tier | Effect |
|---|---|---|
| Basal Aqueduct Pump | Basal | Waterfall + aqueduct channel flow |
| Geothermal Conduit | Basal | Thermal updraft to the canopy (west) |
| Hydroponic Bay | Canopy | Gardens irrigated, north cascade |
| East Sky-Bridge | Canopy | Builds the bridge to the solar tower |
| Solar Cladding Array | Canopy | Tall thermal to the Apex (east) |
| Crown Wind Turbines | Apex | Turbines spin; sky-line grapple chain lights up |
| Cloud-Deck Cascade | Apex | Grand cascade + rainbow |

Initial routes up: the stepped pillars west of the spire (climb + rest on top), and the grapple rings at the canopy rim and on the sky anchors.

## Security
- **Deploy `public/` only.** It contains no secrets; anyone with the URL can download the client.
- **Dependencies vendored.** They were checked against npm's published sha512 hashes (three@0.160.0 including its examples, peerjs@1.5.4). No third-party script hosts at runtime.
- **CSP** (meta tag in `index.html`):
  - scripts only from the same origin, no inline scripts
  - network connections only to the same origin and the PeerJS signalling server (`0.peerjs.com`)
  - no plugins or `<base>` tags
- **All network input is untrusted.** In both directions, every peer message is type-checked and clamped before use (`safe*` helpers in `game.js`). Names and chat are escaped; colours must match `#rrggbb`; character looks are indices checked against fixed option lists; puzzle actions are validated by the host, including a distance check against the sender's last known position; pings are rate-limited per player and emotes clamped to known values; node IDs are checked against a fixed list; pickup IDs must be in range.
- **Per-peer rate limits on the host.** Overall messages: 40/s, bursts up to 80. Chat: 1/s, bursts up to 5. A peer that keeps flooding is disconnected.
- **Room codes** come from `crypto.getRandomValues` (5 characters from a 32-letter alphabet).
- **Known limits (by design for a friends playtest):**
  - Peer-to-peer means players can see each other's IP addresses.
  - Anyone with a room code can join; there are no passwords or kick option.
  - The host is trusted for game state, so a modified host can cheat, but can't run code on your machine.
  - If you change the CSP's connect-src, or point PeerJS at your own signalling server, update both.

## Code map (`public/game.js`)
- `CFG`: tuning constants (stamina 100, climb 15/s, glide 8/s, 1.5 s regen delay, 20 Hz net, 0.05-unit delta threshold)
- `Physics`: custom AABB collision with step-up, wall probes, camera ray tests
- `World`: procedural world, `RestorationNode`s, `ThermalZone`s, anchors, pickups, and the per-tier dull→vibrant colour shift
- `PlayerController`: IDLE/WALK/RUN/CLIMB/GLIDE/FALL (+GRAPPLE), stamina/exhaustion
- `NetworkManager`: PeerJS star topology; `PLAYER_JOIN/LEAVE`, `PLAYER_MOVE`, `NODE_PROGRESS_UPDATE`, `NODE_RESTORED`, pickup and chat events
- `game.apply()`: the single event path for host, client and solo

For console tinkering, `window.__game` exposes state, and `__game.simulate(dt)` steps the game deterministically.
