# Canopy Spire — Multiplayer Web Prototype

A solarpunk, non-violent, co-op traversal game: climb, glide and grapple through a vertical city and restore its broken infrastructure. Built from `canopy_spire_prd_sdd_multiplayer_web_prototype.md` as a static, no-build web app in `public/`. Three.js r160, PeerJS 1.5.4 and the Rapier 0.21.0 physics engine (`@dimforge/rapier3d-compat`, a single ES module with its WebAssembly inlined) are vendored in `public/vendor/`, along with Three.js example add-ons: OutlineEffect, RoundedBoxGeometry, BufferGeometryUtils, GLTFLoader, SkeletonUtils, and the post-processing set (EffectComposer, Pass, MaskPass, ShaderPass, UnrealBloomPass, OutputPass, CopyShader, LuminosityHighPassShader, OutputShader). The add-ons are unmodified except that their `'three'` import points at the local copy.

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
- Peer-to-peer via WebRTC. The public PeerJS cloud server only does signalling, so there is no server to run. The host is authoritative for node progress, pickups, chat and physics objects (it simulates them and streams their positions to everyone). If the host leaves, clients continue solo with the world state they had.
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
| I / Tab | Backpack: items & crafting |
| 1–5 | Select tool · LMB / V = use it |
| T | Track the next unrestored node (compass + on-screen waypoint) |
| G / Middle-click | Ping a spot for everyone ("⚡ here", node names…) |
| B then 1–4 | Emote: wave, cheer, dance, sit |
| E (at a sky-line post) | Ride the sky-line zipline |
| H | Help · mouse wheel = camera distance |
| Esc | Game menu: resume, copy invite link, leave to home screen |

## Look & graphics
- **Customize your character** on the home screen: outfit, accent, skin, hair, hat (none, straw, cap, flower crown, hood, beanie, goggles) and glider colour, with a live 3D preview. Your look is saved in this browser and shown to everyone in the room.
- **Graphics** (home screen or Esc menu):

  | Preset | Render scale | Shadows | Ink outlines | Grass | Colour grade | Bloom |
  |---|---|---|---|---|---|---|
  | Low | 1x | 1024 | off | sparse | off | off |
  | Medium | up to 1.5x | 2048 | on | medium | on | off |
  | High (default) | 1.25–2x | 4096 | on | dense | on | on |
  | Ultra | 2–3x | 4096 | on | densest | on | on |

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
| Two Hands, One Gate | Brindle (east) | **Pressure-plate vault:** hold all three plates at once, with friends standing on them or with the seed-stones (walk into one to roll it, or press E to lift/set it down). Then claim the key inside. Opens the **Grotto portal**. |
| Light in the Grotto | Aster (Portal Plaza, north) | **Crystal Grotto realm:** rotate seven mirrors so the sunbeam, split by a prism, lights *both* receivers. Take the Spirit Orb of Light. |
| Winds of the Archipelago | Aster | **Sky Archipelago realm:** a floating-island parkour trial using jumps, a bounce bloom, a thermal and a grapple chain to the summit shrine. Take the Spirit Orb of Wind. |
| The Keepers' Blessing | Mossa | Bring both orbs back to unlock the **Keeper's Circlet** hat and the **Starlight Glider**. |

- **Shared puzzle state:** puzzle progress and opened portals are shared world state, run by the host and saved with the host's spire, so friends can solve them together and follow through portals.
- **Per-player progress:** quest progress, Spirit Orbs and the cosmetic unlocks belong to each player.
- **Rewards:** each quest also grants restoration materials.

## Tools, crafting & side quests
**Backpack (I):**
- **Items:** every item, with descriptions.
- **Craft:** combine parts into components and tools.

**Parts:** you gather these as glowing pickups that respawn for each player.
- 🐚 shells come from the Lagoon.
- 🪶 feathers come from rooftops and sky isles.
- 💎 crystals come from the Grotto and Bloomwood.
- 🌸 moonpetals come from Bloomwood.
- 🍯 resin comes from the island's trees.
- 🔩 springs and 🫘 seeds are crafted.

| Tool | Recipe | What it does |
|---|---|---|
| 🚿 Watering Can | 2🐚 2⚙️ 1🍯 | Withered sprouts grow into a leaf staircase up the spire, a climbable beanstalk to the solar terrace, and a giant flower. Also waters the Thornheart's roots. |
| 🏮 Glow Lantern | 2💎 1⚡ 1🍯 | Toggle light. Glyph platforms are only solid near a lit lantern, *anyone's* lantern, so friends can light the way. Wakes moth shrines. |
| 📯 Wind Horn | 3🪶 1🔩 | Spins wind wheels (opens the Lagoon's coral gate for 20 s). Blow it mid-air for a lift. |
| 👝 Seed Pouch | 1🍯 2🌱 | Plant 🫘 in fertile soil to grow bounce blooms, permanently and for everyone. |
| 🔍 Prism Lens | 2💎 1🌸 1⚙️ | Raise it on a beam pad to bend sunlight into the Thornheart's heart. |

**Side quests:** Pip the Tinker (crafting tutorial), Old Fennel (wake her daughter's sprouts), Juniper the Courier ↔ Captain Skerry (a parcel and a reply), Skerry's lost compass (gate + temple bounce puzzle), and Luma the Moth-Scholar (moth shrines, glyph climb, Moon Altar). Rewards include the Captain's Hat and materials.

**New realms** (Portal Plaza):
- **Tidepool Lagoon** is always open.
- **Moonlit Bloomwood** opens after either main-island puzzle.
- **Thornwood Hollow** opens when the Moon Altar wakes.

**The Thornheart (co-op boss — you heal it):**
1. Water its three roots within 25 s of each other.
2. Hold two sunbeams on its heart for 3 s. The west pad needs a raised Prism Lens; the east pad takes a lens or the rotatable mirror, so it's solo-able.
3. Sing back its 6-note song on four flowers spread around the arena.

Jump over the thorn waves it sends out. Healing it grants the Heartwood Seed and unlocks the Heartwood Glider.

Bloomed sprouts, planted blooms, shrines, the altar and the healed Thornheart are shared world state, saved with the host's spire. Items, tools and quest progress belong to each player.

## Things to do besides restoring
- **Physics objects:** walk into crates, barrels and the vault's seed-stones to push them. You can stand on them and stack them; everyone in the room sees the same result. Crates sit by the spawn point, the Root Vault and the chime plaza.
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

## Art pipeline (Blender → glTF)
Characters, the Thornheart, trees and key props are authored in **Blender 4.2 LTS** as Python scripts in `art/blender/`, and exported to `public/assets/*.glb`, which the game loads at startup.

| Script | Output | What's in it |
|---|---|---|
| `character.py` | `character.glb` | Rigged player/NPC (15 bones), 13 clips (Idle, Walk, Run, Climb, Glide, Fall, Grapple, Zip, Wave, Cheer, Dance, Sit, Hold), 10 hats, paraglider |
| `thornheart.py` | `thornheart.glb` | Rigged boss with Sway / Roar / Calm clips; named `Heart`, `Thorns`, `Blossoms` parts the game drives |
| `trees.py` | `trees.glb` | 9 tree variants (`Tree_<round|blossom|pine|tall>_<n>`) |
| `props.py` | `props.glb` | `LampPost`, `Bench`, `PortalArch`, `ChimePillar`, `SongbirdRock`, `SongbirdBird` |

Rebuild everything, or a single asset, headless:
```bash
BLENDER=/path/to/blender art/build.sh            # all assets
BLENDER=/path/to/blender art/build.sh character  # one asset
python3 art/inspect_glb.py public/assets/*.glb    # summary: verts, materials, clips
```

**Conventions** (see `art/blender/common.py`):
- **Orientation:** Blender is Z-up, and models face −Y. They arrive in the game Y-up and facing +Z.
- **Materials:** material *names* are roles (`Outfit`, `Skin`, `Bark`, `Leaves`, `Glow`…). The game swaps each for its cel-shaded material and recolours roles: player looks, district vibrance, lamp glow and the boss's healing.
- **Bones:** names avoid dots, because three.js strips them.
- **Static props:** these are baked into the game's merged static batches, so they cost almost nothing to draw.
- **Fallbacks:** every asset has one. If a `.glb` is missing or fails to load, the game uses its original procedural geometry, so gameplay never depends on art.

Opening a script in Blender's Scripting tab and running it shows the model in the editor. Hand-editing in Blender is fine too: export with the same object, material and bone names, and the game picks it up.

## Security
- **Deploy `public/` only.** It contains no secrets; anyone with the URL can download the client.
- **Dependencies vendored.** They were checked against npm's published sha512 hashes (three@0.160.0 including its examples, peerjs@1.5.4, @dimforge/rapier3d-compat@0.21.0). No third-party script hosts at runtime.
- **CSP** (meta tag in `index.html`):
  - scripts only from the same origin, no inline scripts; `'wasm-unsafe-eval'` lets the vendored Rapier WebAssembly compile (it doesn't allow JavaScript `eval`)
  - network connections only to the same origin and the PeerJS signalling server (`0.peerjs.com`)
  - no plugins or `<base>` tags
- **All network input is untrusted.** In both directions, every peer message is type-checked and clamped before use (`safe*` helpers in `game.js`). Names and chat are escaped; colours must match `#rrggbb`; character looks are indices checked against fixed option lists; puzzle actions are validated by the host, including a distance check against the sender's last known position; pings are rate-limited per player and emotes clamped to known values; tool, world-change and boss actions are validated by the host (tool held, distance, phase); node IDs are checked against a fixed list; pickup IDs must be in range; physics pushes must name a real body, be a unit direction, and come from a player standing next to it, and only the host's body snapshots are applied.
- **Per-peer rate limits on the host.** Overall messages: 40/s, bursts up to 80. Chat: 1/s, bursts up to 5. A peer that keeps flooding is disconnected.
- **Room codes** come from `crypto.getRandomValues` (5 characters from a 32-letter alphabet).
- **Known limits (by design for a friends playtest):**
  - Peer-to-peer means players can see each other's IP addresses.
  - Anyone with a room code can join; there are no passwords or kick option.
  - The host is trusted for game state, so a modified host can cheat, but can't run code on your machine.
  - If you change the CSP's connect-src, or point PeerJS at your own signalling server, update both.

## Code map (`public/game.js`)
- `CFG`: tuning constants (stamina 100, climb 15/s, glide 8/s, 1.5 s regen delay, 20 Hz net, 0.05-unit delta threshold)
- `Physics`: custom AABB collision with step-up, wall probes, camera ray tests. Every static box is also mirrored as a fixed Rapier collider
- `DYN` / `dyn*()`: Rapier rigid bodies (crates, barrels, seed-stones). The authority steps them at 60 Hz, broadcasts `BODIES` at 15 Hz (awake bodies only), and takes `BODY_PUSH` requests. Each body also gets a moving AABB proxy so the player controller can stand on and bump into it
- `World`: procedural world, `RestorationNode`s, `ThermalZone`s, anchors, pickups, and the per-tier dull→vibrant colour shift
- `PlayerController`: IDLE/WALK/RUN/CLIMB/GLIDE/FALL (+GRAPPLE), stamina/exhaustion
- `NetworkManager`: PeerJS star topology; `PLAYER_JOIN/LEAVE`, `PLAYER_MOVE`, `NODE_PROGRESS_UPDATE`, `NODE_RESTORED`, pickup and chat events
- `game.apply()`: the single event path for host, client and solo

For console tinkering, `window.__game` exposes state, and `__game.simulate(dt)` steps the game deterministically.
