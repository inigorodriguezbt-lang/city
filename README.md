# URBIS

A realistic city builder that runs entirely in your browser — Three.js, Web
Workers and TypeScript, no server, no downloads. Every building, tree, car,
texture, sound and piece of music is generated procedurally at runtime.

## Play

```bash
npm install
npm run dev            # http://localhost:5173
```

Production builds:

```bash
npm run build          # dist/ (multi-file)
npm run build:single   # dist-single/index.html — one self-contained file
```

Serve either build over HTTP (Web Workers don't run from `file://`), e.g.
`npx http-server dist-single`. Append `?autostart=1&size=small&seed=42` to skip
the menu (`&theme=boreal`, `&creative=1` also work).

## What's in it

- **Worlds** — 6 biomes (temperate valley, boreal fjords, desert oasis,
  tropical archipelago, alpine heights, Mediterranean coast) × 4 map sizes
  (4–12 km) × any seed. Eroded terrain, rivers that run downhill into lakes and
  the sea, forests, fertile land, ore, oil and wind resources, a highway and
  railway already connecting you to the outside world.
- **Building** — 8 road types (gravel to highway, pedestrian streets, rail, tram
  avenues) with bridges, auto-grading and junction markings; 12 zone types that
  grow into procedurally generated buildings across 5 levels in 8 architectural
  styles (North American, European, Mediterranean, Nordic, East Asian, Art Deco,
  Contemporary, Futuristic); 152 service buildings, landmarks and monuments,
  each with its own model; terraforming, tree planting and districts.
- **Simulation** — demand for residential, commercial, industrial and office
  space; population, jobs, education, health, crime, happiness, land value,
  pollution and noise; power, water and sewage networks along your roads;
  service coverage along real road distance; garbage and deathcare capacity;
  taxes, budgets, loans and bankruptcy; 42 policies with district overrides and
  specialisations; 14 milestones from Settlement to Ecumenopolis (1M people);
  73 achievements; citizen chirps and an advisor.
- **Traffic** — agent vehicles with lanes, turns, signals and congestion,
  service vehicles with sirens, trucks, tourists and commuters from outside,
  and bus, tram, metro, train, ferry and monorail lines you draw yourself.
- **Life** — day/night cycle, seasons, weather (rain, storms with lightning,
  snow, fog, heat waves, blizzards), 42 random events and disasters (fires,
  tornadoes, earthquakes, meteors, floods, tsunamis, festivals with
  fireworks, a UFO…).
- **Quality of life** — undo/redo (100 steps), live cost previews, drag-to-build,
  auto-rotation toward roads, info views for every field, minimap, building
  inspector with named residents, statistics and graphs, search (Ctrl+F),
  photo mode, screenshots, autosave, quicksave, save export/import, GUI scale,
  full key rebinding, touch controls.

## Controls (defaults — all rebindable in Options → Controls)

| Action | Keys |
| --- | --- |
| Move camera | WASD / arrows, middle-drag, edge scroll (optional) |
| Rotate / tilt | Q / E, right-drag, PageUp / PageDown |
| Zoom | mouse wheel (toward cursor), + / − |
| Pause / speeds | Space, 1 2 3 4 |
| Roads / zoning / services menus | N / Z / V |
| Bulldoze | B |
| Rotate building | R |
| Brush size | [ and ] |
| Pick building under cursor | I |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Budget, stats, info views, policies, milestones | F, C, O, L, U |
| Search buildable | Ctrl+F |
| Chat / command | T or Enter / `/` |
| Hide UI, screenshot, photo mode | F1, F2, P |
| Quick save / load | F5 / F9 |
| Performance overlay | F3 |

Road tool: drag from A to B (L-shaped); hold **Shift** for straight, **Ctrl** for
auto-routing, **Alt** to build over zoned buildings.

## Chat commands

Open chat with `T` and type `/help`. Highlights:

```
/give money 1000000        /give unlockall          /give milestone 8
/give residents 5000       /give building stadium   /tp 120 200 | home | <name>
/time set 21:30            /time speed 4            /time add 30
/weather storm 3           /locate hospital         /summon tornado
/creative on               /disasters off           /overlay landValue
/save "My City"            /load "My City"          /export   /screenshot
/fill res_low 10 10 30 30  /bulldoze abandoned      /kill vehicles   /stats
```

Cheats mark a city as cheated, which disables achievements for it.

## Architecture

See [DESIGN.md](DESIGN.md). In short: a single serializable `World`
(typed-array layers + entities), systems for simulation, fields (in a Web
Worker), traffic (A* in a Web Worker), events and weather; chunked renderers
for terrain, water, trees, roads, zones, buildings, vehicles and effects; a
vanilla-DOM UI. Map generation also runs in a worker.
