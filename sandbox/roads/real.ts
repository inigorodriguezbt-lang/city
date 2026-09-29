// Optional sandbox stage (?real=1): the real GameRenderer (sky, terrain, water,
// trees, post) from render-core, driven by a minimal fake Game, so road and
// zone colors can be judged under the actual game lighting. Falls back to the
// basic stage in main.ts when not requested.
import * as THREE from 'three';
import type { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { DEFAULT_KEYBINDS, defaultSettings, type ActionId } from '../../src/settings/types';
import type { Game } from '../../src/game/Game';
import type { World } from '../../src/world/World';
import { GameRenderer } from '../../src/render/Renderer';

export interface RealStage {
  gr: GameRenderer;
  game: { events: EventBus<GameEvents>; world: World; renderer: GameRenderer; simDt: number };
  setView(x: number, y: number, dist: number, azDeg: number, elDeg: number): void;
  step(dt: number): void;
  render(): void;
}

export function createRealStage(world: World, events: EventBus<GameEvents>): RealStage {
  const settings = defaultSettings();
  settings.graphics.shadows = 'high';
  settings.graphics.tiltShift = false;
  const keys = new Set<string>();
  const input = {
    enabled: true,
    pointer: { x: 0, y: 0, overCanvas: false },
    isDown: (a: ActionId) => (settings.controls.keybinds[a] ?? DEFAULT_KEYBINDS[a]).some((k) => keys.has(k)),
    onAction: () => () => {},
    onPointer: () => () => {},
    onGesture: () => () => {},
  };
  const view = document.createElement('div');
  view.style.cssText = 'position:absolute;inset:0';
  document.body.prepend(view);
  const game = { events, settings: { value: settings }, input, world, renderer: null as unknown as GameRenderer, simDt: 0, roadSurface: null as unknown };
  const gr = new GameRenderer(game as unknown as Game, view);
  game.renderer = gr;
  gr.applySettings(settings);
  gr.onWorldLoaded(world);
  events.emit('world:loaded', world);
  return {
    gr,
    game,
    setView(x, y, dist, azDeg, elDeg) {
      gr.cameraCtl.setPose(x, y, dist, THREE.MathUtils.degToRad(azDeg), THREE.MathUtils.degToRad(elDeg));
    },
    step(dt) {
      gr.update(dt);
    },
    render() {
      gr.render();
    },
  };
}
