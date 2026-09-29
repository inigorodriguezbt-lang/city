# URBIS — Design & Architecture

URBIS is a realistic, deep city builder that runs entirely in the browser
(Three.js + Web Workers + TypeScript + Vite, no server). This document is the
contract every module is built against. **Read it fully before writing code.**

---

## 1. Vision & pillars

1. **Breathtaking to look at.** Warm physically-based lighting, long soft
   shadows at golden hour, glittering night skylines, living streets full of
   cars and people, seasons and weather. Every building is procedurally
   generated with real architectural logic (floors, bays, roofs, balconies,
   storefronts, rooftop HVAC, water towers, antennas) in 8 architectural styles.
2. **Deep, readable simulation.** Zones grow organically from demand, land
   value and services. Buildings level up 1→5, merge into larger lots, or get
   abandoned. Power, water, sewage, garbage, health, education, crime, fire,
   deathcare, parks, transit, tourism, pollution, noise and traffic all matter
   and are all visualised as info-view overlays.
3. **Hundreds of hours.** 14 population milestones (Settlement → Ecumenopolis,
   1M citizens), ~150 service/landmark/monument buildings, 12 zone types,
   8 styles, 6 biomes × infinite seeds × 4 map sizes, ~40 random events
   & disasters, ~30 policies, districts with specialisations, transit networks,
   ~60 achievements, loans, and a sandbox creative mode.
4. **Respect the player.** Undo/redo, drag-to-build with live cost preview,
   autosave, keyboard-first controls with full rebinding, info tooltips
   everywhere, jump-to notifications, search, pause-on-disaster, GUI scale.

## 2. Tech & conventions

- TypeScript `strict`. Vanilla DOM UI (helpers in `src/ui/dom.ts`), no framework.
- Three.js r186 `WebGLRenderer` (not WebGPU). Addons from `three/examples/jsm/...`.
- Web Workers via Vite: `import MyWorker from './x.worker?worker&inline'` then
  `new WorkerRPC(new MyWorker())` (see `src/core/rpc.ts`, worker side uses
  `exposeWorker`). Always `?worker&inline` so the single-file build works.
- **No external assets.** All textures are generated at runtime (canvas /
  DataTexture), all models procedural, all audio synthesized (WebAudio).
- Fonts: Inter (UI), Outfit (display), JetBrains Mono (console) from Google
  Fonts with system fallbacks.
- Determinism: use `RNG` / `hash*` from `src/core/rng.ts` seeded from world or
  building seeds. `Math.random()` only for non-gameplay visual jitter.
- Commands: `npm run typecheck`, `npm run build`, `npm run build:single`.
  Dev: `npm run dev`. Test URL: `/?autostart=1&size=small&seed=42` skips the menu.
  `window.__game` exposes the `Game` instance.

### Frozen contracts (additive changes only, by the integrator)

`src/core/*`, `src/world/World.ts`, `src/game/Game.ts`, `src/settings/types.ts`,
`src/render/buildings/types.ts`, `src/render/buildings/registry.ts`,
`src/render/buildings/ModelBuilder.ts`, `src/tools/Tool.ts`, `src/data/roads.ts`,
`src/data/zones.ts`, `src/data/styles.ts`, `src/data/themes.ts`,
`src/data/milestones.ts`, `src/ui/dom.ts`, `src/ui/theme.css`, `src/main.ts`,
`index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`.

Every system class exists as a **stub with its public API already declared**
(see the ownership table). When you implement a module: keep every existing
public member with the same signature (you may add members, private helpers,
and new files inside your owned directories). Only call other modules through
their declared public API — they are being written in parallel by other agents.
If you truly need something from another module, write it down in your final
report under "Integration requests" instead of editing their files.

## 3. Units & coordinates

- Grid cell = **16 m** (`CELL`). Chunk = 32×32 cells (`CHUNK`).
- Cell `(x, y)`: `x → +X`, `y → +Z`; Three.js `Y` is up. Cell spans
  `[x*16,(x+1)*16] × [y*16,(y+1)*16]`; center = `world.cellCenter(x,y)`.
- Directions `Dir`: `N=0 (-Z)`, `E=1 (+X)`, `S=2 (+Z)`, `W=3 (-X)`;
  `DIR_DX/DIR_DY/DIR_BIT` in `core/types.ts`.
- Terrain heights live at cell **corners**: `world.heights[(size+1)^2]`.
  `cellHeight`, `heightAt(wx,wz)` (bilinear), `cellSlope`.
- Water: `world.water[size^2]` = water **surface elevation** per cell; a cell is
  wet when surface > terrain + `WATER_EPS`. Sea cells hold `seaLevel` (flood
  events add `world.floodOffset`, applied by `world.waterLevel()`). Lakes and
  rivers may sit at other elevations (rivers descend).
- Building model local space: origin at footprint **center** on lot ground,
  front (road side) faces **+Z**, width (frontage) along X, depth along Z.
  World rotation for `rot`: `S → 0`, `E → +π/2`, `N → π`, `W → −π/2` about Y.
  Frontage in cells = `rot is N/S ? b.w : b.h`.
- Map sizes 256/384/512/768 cells (4–12 km).

## 4. Architecture

```
Game (src/game/Game.ts) — owns loop, world lifecycle, global hotkeys
 ├─ World (state, low-level mutators, batched change events)
 ├─ WorldActions (validated player actions, cost, undo/redo)
 ├─ Simulation  ─ time, growth, population, economy, demand, milestones, policies
 ├─ FieldSystem ─ utilities + coverage + pollution/noise/land value/crime (worker)
 ├─ TrafficSystem ─ vehicles, pathfinding (worker), congestion, transit lines
 ├─ EventSystem ─ random events, disasters, weather, fires
 ├─ GameRenderer ─ three.js core, camera, sky, terrain, water, trees, overlays, post
 │   RoadRenderer, ZoneRenderer, BuildingRenderer (+service models),
 │   VehicleRenderer, EffectsRenderer — each adds to renderer.scene
 ├─ InputManager + ToolManager (+ tools)
 ├─ UIManager (HUD, panels), MenuSystem (menus/options), ChatConsole
 ├─ SaveManager, CommandRegistry, AudioManager, SettingsStore
```

Frame order (`Game.step`): input → tools → sim → fields → traffic → events →
`world.flushChanges()` → roads/zones/buildings/vehicles/effects `update` →
renderer.update/render → ui → saves → audio. When a menu is open the sim is
frozen but rendering continues.

**Change propagation.** All world mutations go through `World` mutators, which
mark a dirty rect + `Layer` bits; `flushChanges()` emits one
`'world:changed' {rect, layers}` per frame. Renderers mark affected chunks dirty
(`ChunkGrid` helper) and rebuild a bounded number of chunks per frame (nearest
to camera first). `building:added/removed/changed` fire immediately.

**Time.** `REAL_SECONDS_PER_DAY = 2` at 1x; speeds `[0,1,2,4,10]`.
`TICKS_PER_DAY = 8` fixed ticks (`'sim:tick'`), plus `'sim:day'`,
`'sim:month'` (30 days) and `'sim:year'` (360 days). The visual time of day
(`world.time.hour`) advances independently: a full 24 h cycle takes
`settings.gameplay.dayCycleMinutes` real minutes at 1x (scaled by speed).
`game.simDt` = this frame's dt × speed multiplier (0 when paused) — use it for
anything that should move with game time (vehicles, fire spread, particles
that are gameplay-driven). Pure ambience (water waves, clouds) may use real dt.

**Persistence.** Everything that must survive save/load lives on `World`
(module-specific state goes in `world.ext['<module>']`, JSON-serializable).
Vehicles and particles are transient and re-created after load.

## 5. Ownership (who writes what)

| Agent | Owns (create/modify only these) | Implements |
|---|---|---|
| mapgen | `src/world/mapgen/**`, `src/workers/mapgen.worker.ts` | `generateMap()` |
| tools | `src/world/actions.ts`, `src/world/history.ts`, `src/tools/**` (except `Tool.ts`, `src/tools/transit/**`), `src/input/**` | `WorldActions`, `ToolManager`, all tools, `InputManager` |
| sim-core | `src/sim/*.ts` (not subdirs), `src/sim/consumption.ts`, `src/data/policies.ts`, `src/data/achievements.ts`, `src/data/names.ts` | `Simulation` |
| fields | `src/sim/fields/**`, `src/workers/fields.worker.ts` | `FieldSystem` |
| traffic | `src/sim/traffic/**`, `src/workers/path.worker.ts`, `src/render/vehicles/**`, `src/render/pedestrians/**`, `src/tools/transit/**` | `TrafficSystem`, `VehicleRenderer`, transit tool |
| events | `src/sim/events/**`, `src/data/events.ts`, `src/render/effects/**`, `src/render/weather/**` | `EventSystem`, `EffectsRenderer`, weather visuals |
| render-core | `src/render/Renderer.ts`, `src/render/CameraController.ts`, `src/render/{terrain,water,sky,overlay,props,post,textures}/**` | `GameRenderer`, camera, terrain, water, sky, trees, overlays, post-FX |
| roads | `src/render/roads/**`, `src/render/zones/**` | `RoadRenderer`, `ZoneRenderer` |
| buildings-zoned | `src/render/buildings/BuildingRenderer.ts`, `src/render/buildings/materials.ts`, `src/render/buildings/zoned/**`, `src/render/buildings/icons/**` | chunked building renderer, material library, zoned generators, problem icons |
| buildings-service | `src/data/buildings.ts`, `src/render/buildings/service/**` | full service/landmark catalog + every model |
| ui-hud | `src/ui/UIManager.ts`, `src/ui/hud/**`, `src/ui/panels/**`, `src/ui/hud.css` | HUD, toolbar, panels, notifications, minimap, tooltips |
| ui-menus | `src/ui/menus/**`, `src/ui/chat/**`, `src/ui/menus.css`, `src/settings/SettingsStore.ts` | main menu, new game, save/load, options & key rebinding, pause, chat UI, settings store |
| systems | `src/save/**`, `src/commands/**`, `src/audio/**` | saves (IndexedDB, export/import), all chat commands, audio |

## 6. Gameplay design

### 6.1 Roads (`data/roads.ts`)
Grid roads, one per cell, auto-connecting (masks via `world.roadMask`).
Types: gravel, street, avenue, boulevard (tree median), highway (no zoning),
pedestrian street, rail, tram avenue. Road tool: click-drag from A to B;
default L-shaped path (hold Shift for straight/diagonal staircase, Ctrl for
auto-path A*). Live ghost preview, red invalid cells, cost label, bridges over
water (roadFlags bit0) with pylons, max slope `MAX_ROAD_SLOPE` (the tool
auto-grades terrain along the road by smoothing corner heights), cannot cross
buildings (unless Alt = replace). Upgrading: dragging a different type over
existing road upgrades it and charges the difference. Highways connect to
roads only at their ends (allowed anyway, simple grid). Street lights on
streets+.

### 6.2 Zoning & growth
Zones (`data/zones.ts`) can be painted on land cells within `MAX_ZONE_DEPTH` (4)
cells of a zoning-enabled road, not on water/road/service buildings, slope ≤
`MAX_LOT_SLOPE`. Tools: brush (sizes 1–9), rectangle drag, fill (contiguous),
dezone. Specialised industry zones require their resource field (> 60).

Growth (sim-core), each tick processes a slice of the map:
- For each zone category with positive demand, pick candidate empty zoned cells
  with road access (adjacent road within the lot's front edge). Choose a lot size
  from `ZoneDef.lots` (frontage × depth) that fits cells of the same zone,
  empty, dry, not too steep, with frontage on a road; prefer larger lots at
  higher land value. Orient the front toward the road.
- Spawn with `world.addBuilding({kind:'zoned', defId:'zoned:'+zone.id, …})`,
  `built = 0`; construction takes ~6–20 days (scaffolding visual), style =
  district style ?? city style, `seed` from RNG.
- Level 1→5 driven by land value + services coverage + education (res),
  customers/goods (com), educated workers (ind/off). Level-up = `touchBuilding`.
  Capacity = `capacityPerCell × area × LEVEL_CAPACITY[level]`.
- Problems (no power/water/sewage/road, garbage, crime, sick, fire, no
  workers/customers/goods, pollution, noise, dead) accumulate `distress`;
  sustained distress → `Abandoned` (visual decay) → auto-bulldoze optional.
- Adjacent small lots may be merged into a larger building when density rises.
- Farming zones spawn fields (crops) + barns; forestry = sawmills with logs;
  mining = pits/quarries with conveyors; oil = derricks and tanks.
- Mixed use = shops on the ground floor, apartments above.

### 6.3 Demand (RCIO) and population
Aggregate model. Households with residents (avg 2.6/household), workforce
~55% of residents, students ~18%. Residential demand rises with jobs
available, happiness, land value, low taxes; commercial with residents' buying
power and tourists vs commercial capacity; industrial with commercial need for
goods + exports via outside connections (cargo); office with educated
workforce. Demand ∈ [−1,1] shown as RCIO bars. Immigration/emigration each
day. Births/deaths, aging (children→students→workers→seniors, simplified via
ratios), education levels improve with school coverage and capacity.
Citizens have deterministic names (`data/names.ts`) used in chirps and info
panels.

### 6.4 Economy
Start money by difficulty (`START_MONEY`). Taxes per `TaxCategory` 0–29%
(default 9–10%); high taxes hurt demand and happiness. Income monthly =
taxes (by zone, level, occupancy, land value) + tourism + transit fares +
exports. Expenses = building upkeep × budget slider (50–150% effectiveness vs
cost) + road upkeep + policy costs + loan payments. Loans: 3 tiers (amount,
rate, term). Bankruptcy warning when money < 0 for 3 months (game continues but
construction blocked). Everything is shown in the Budget panel with
projections. `world.spend/charge/earn` record categories.

### 6.5 Services & utilities (field system)
- **Power**: plants produce MW (`def.power`). Power propagates through the road
  network (and adjacent buildings: a building is connected if it touches a
  powered road cell or a powered building). If total consumption > production,
  consumers farthest from plants lose power first. Wind turbine output scales
  with the `wind` field; solar with daylight/season.
- **Water / sewage**: same network propagation along roads (pipes follow
  roads). Pumps need shoreline and produce water; outlets dump sewage (polluting
  water downstream); treatment plants reduce pollution. Groundwater pollution
  near industry reduces pump quality.
- **Coverage fields** (0–255): each service building emits its `effects` with
  radius falloff along roads (road-distance aware: use a Dijkstra/BFS over the
  road graph from the building's access cells limited by radius, then blur to
  lots), scaled by the building's `efficiency` (budget × staffing).
- **Environment fields**: pollution (industry, plants, traffic, landfill;
  spreads with wind), noise (roads by traffic, industry, commercial, airport),
  crime (−police, +unemployment, +low land value), land value (+services,
  parks, water views, transit, education; −pollution, noise, crime, garbage),
  happiness, tourism, traffic.
- Recompute in `fields.worker.ts` every ~1 in-game day or when utilities change
  (throttled), transferring typed arrays; results written into `world.fields`
  then `'fields:updated'` emitted.

### 6.6 Traffic & transit
Agent-based vehicles on the road cell graph, capped by
`graphics.vehicleDensity` (e.g. up to 3000 at 1.0). Trips: commutes (homes →
jobs), shopping (homes → commercial), freight (industry → commercial /
outside), services (fire trucks, ambulances, police, garbage, hearses), transit
vehicles, tourists from outside connections. A* paths computed in
`path.worker.ts` (batched requests, weighted by road speed and congestion).
Vehicles follow lanes (right-hand traffic), stop at junction queues, respect
speed limits, turn smoothly (curved turns inside a cell), yield when a cell's
occupancy exceeds its capacity. Congestion per road cell → `fields.traffic`
and the traffic overlay; average flow % into `stats.trafficFlow`. Bridges
follow the deck height. Transit lines (bus/tram/metro/train/ferry/monorail):
players place stops by clicking cells, vehicles loop the line; lines reduce
car trips in covered areas (`transit` field) and earn fares.

### 6.7 Events, disasters, weather
Weather state machine per theme and season (clear, cloudy, rain, storm,
snow, fog, heatwave, blizzard) with visuals (rain/snow particles, darker sky,
wet roads sheen, snow cover, lightning, fog density) and gameplay effects
(heating/water/power demand, traffic slowdowns, park usage). Random events
(`data/events.ts`, ~40): positive (festival, celebrity visit, tech boom,
tourism surge, sports championship, meteor shower sightseeing, film shoot),
negative (recession, strike, epidemic, crime wave, power grid failure,
water main break, heat wave, drought, traffic jam, pest outbreak, protest),
disasters (building fire + spread, tornado path, earthquake, flood / storm
surge, meteor strike, tsunami on coasts, forest fire, sinkhole, blizzard,
lightning storm, industrial explosion) — plus fun rare ones (UFO sighting,
giant meteor, lost dinosaur balloon parade). Disasters can be toggled at game
start and via `/disasters`. Disaster response buildings reduce damage.
Destroyed buildings become rubble (`BFlag.Collapsed`) until cleared.

### 6.8 Progression
14 milestones (`data/milestones.ts`) unlock roads/zones/buildings/styles via
their `unlock` index; cash rewards; fanfare + notice. ~60 achievements
(`data/achievements.ts`) checked monthly. Policies (~30) toggled city-wide or
per district. Districts: paint cells, name, colour, style, policies,
specialisation. Creative mode: unlimited money, all unlocked, instant
construction optional.

### 6.9 Chat commands (systems agent)
`/help [cmd]`, `/give money <amount>`, `/give unlockall`, `/give milestone <n>`,
`/give residents <n>`, `/give building <defId> [x y]`, `/tp <x> <y>` (cells) |
`/tp home` | `/tp <building name or id>`, `/time set <HH:MM|day|noon|dusk|night|midnight>`,
`/time speed <0-4>`, `/time add <days>`, `/weather <type> [days]`,
`/season` (info), `/locate <defId|category|name>` (lists matches, flies to
nearest, `/locate next`), `/summon <event id> [x y]` (tornado, meteor,
earthquake, fire, flood, ufo, festival…), `/creative on|off`,
`/disasters on|off`, `/speed <n>`, `/seed`, `/stats`, `/fps`, `/clear`,
`/save [name]`, `/load <name>`, `/export`, `/screenshot`, `/fill <zone> x0 y0 x1 y1`,
`/kill vehicles`, `/bulldoze abandoned`. Tab-completion, history (↑/↓),
colored output. Cheat commands work in any mode (single-player) but print
"(cheat)" and disable achievements for that city (`world.ext.cheated = true`).

## 7. Visual direction

- Realistic, slightly stylised "tilt-shift miniature" look when zoomed in,
  majestic panorama when zoomed out. ACES filmic tone mapping, sRGB output.
- Sun: directional light with PCF soft shadows following the camera focus
  (shadow frustum sized to view), hemisphere sky/ground light, physically based
  sky (three `Sky`) with sun position from time of day + season; stars &
  moon at night; volumetric-looking layered clouds; fog/haze tinted by sky.
- Terrain: chunked LOD heightfield, custom shader blending grass / dry grass /
  dirt / sand / rock / snow by slope, height, moisture noise and theme colors;
  detail noise and micro normal variation; shoreline wetness; snow cover by
  season/weather.
- Water: animated normal waves, fresnel reflection of sky, depth-based color
  (shallow → deep), shoreline foam, specular sun glints, gentle transparency.
- Night: windows light up progressively after dusk (per-building random), street
  lamps with glow sprites, headlights/taillights, neon signs on commercial,
  aircraft warning beacons on towers, bloom.
- Trees: instanced, per-species procedural meshes (conifers, broadleaf, palms,
  cacti), wind sway in vertex shader, seasonal color (autumn, bare/snowy winter).
- LOD everywhere: distant buildings collapse to boxes with baked colors,
  distant trees become impostor-ish low-poly, vehicles culled beyond ~1.5 km.
- Performance targets: 60 fps on a mid-range laptop at medium map with ~50k
  population; ≤ ~600 draw calls; chunk rebuilds budgeted per frame
  (≤ ~4 ms). Merge geometry per chunk per material; InstancedMesh for repeats.

## 8. UI/UX

Layout: top bar (city name, date/clock, speed controls, population, money with
monthly net, happiness, RCIO demand bars, weather), bottom toolbar
(categories: Roads, Zoning, Districts, Electricity, Water, Garbage, Health &
Deathcare, Fire, Police, Education, Parks & Plazas, Transit, Government &
Disaster, Landmarks & Monuments, Terraform & Trees, Bulldoze) with a flyout
palette of cards (icon, name, cost, upkeep, lock state + milestone needed,
tooltip with stats). Right side: info views selector, notifications feed
(chirps, warnings, milestones) with jump-to, advisor tips. Left-bottom: minimap
(click to go, shows zones/roads/water). Panels: Budget & Taxes & Loans,
Statistics & Graphs, Policies, Milestones & Achievements, Districts, Transit
lines, Building inspector (live stats, occupants with names, problems,
upgrade/toggle/bulldoze/rename/follow). Tool hint bar above toolbar (cost,
brush size, errors). Everything scales with `--ui-scale`. Mobile/touch:
one-finger = tool, two-finger = pan/zoom/rotate; toolbar scrolls.

Quality of life: undo/redo (Ctrl+Z/Y, 100 steps), autosave, quicksave (F5/F9),
pause (Space), speeds 1–4, hide UI (F1), screenshots (F2), photo mode (P),
eyedropper (I), rotate (R), brush size ([ ]), Esc chain (close chat → menu →
tool → panels → pause menu), confirmation for expensive bulldozes, search
(Ctrl+F) across all buildables, follow camera on vehicles/buildings, problem
icons over buildings, advisor hints for what the city needs next, tutorial
checklist for new players, colour-blind friendly overlays legend.

## 9. Testing hooks

- `/?autostart=1&size=small&seed=42[&theme=…][&creative=1]` starts a game
  directly; `window.__game` is the Game.
- Headless Chromium works with `--use-angle=swiftshader --enable-unsafe-swiftshader`
  (slow but functional). Serve `dist/` with `npx http-server dist -p 8080 -s`
  or run `npx vite --port 5173` and use Playwright
  (`require('/opt/node22/lib/node_modules/playwright')`).
