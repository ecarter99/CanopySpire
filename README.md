# Canopy Spire — Multiplayer Web Prototype

A solarpunk, non-violent, co-op traversal game: climb, glide and grapple through a vertical city and restore its broken infrastructure. Built from `canopy_spire_prd_sdd_multiplayer_web_prototype.md` as a static, no-build web app in `public/`. Three.js r160 and PeerJS 1.5.4 are vendored in `public/vendor/`.

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
| H | Help · mouse wheel = camera distance |

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
- **Dependencies vendored.** They were checked against npm's published sha512 hashes (three@0.160.0, peerjs@1.5.4). No third-party script hosts at runtime.
- **CSP** (meta tag in `index.html`):
  - scripts only from the same origin, no inline scripts
  - network connections only to the same origin and the PeerJS signalling server (`0.peerjs.com`)
  - no plugins or `<base>` tags
- **All network input is untrusted.** In both directions, every peer message is type-checked and clamped before use (`safe*` helpers in `game.js`). Names and chat are escaped; colours must match `#rrggbb`; node IDs are checked against a fixed list; pickup IDs must be in range.
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
