// Settings contract (FROZEN shape; additive changes by integrator only).

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

/** Every rebindable action. Values in keybinds are KeyboardEvent.code strings,
 *  optionally prefixed by modifiers: "Ctrl+KeyZ", "Shift+KeyR", "Alt+Digit1".
 *  Mouse buttons are not rebindable. */
export const ACTIONS = {
  'camera.forward': 'Camera forward',
  'camera.back': 'Camera back',
  'camera.left': 'Camera left',
  'camera.right': 'Camera right',
  'camera.rotateLeft': 'Rotate camera left',
  'camera.rotateRight': 'Rotate camera right',
  'camera.tiltUp': 'Tilt camera up',
  'camera.tiltDown': 'Tilt camera down',
  'camera.zoomIn': 'Zoom in',
  'camera.zoomOut': 'Zoom out',
  'camera.fast': 'Camera fast move (hold)',
  'camera.reset': 'Reset camera to city hall',
  'game.pause': 'Pause / resume',
  'game.speed1': 'Speed 1x',
  'game.speed2': 'Speed 2x',
  'game.speed3': 'Speed 4x',
  'game.speed4': 'Speed 10x (ultra)',
  'game.quicksave': 'Quick save',
  'game.quickload': 'Quick load',
  'tool.cancel': 'Cancel tool / close panel',
  'tool.rotate': 'Rotate building',
  'tool.bulldoze': 'Bulldozer',
  'tool.roads': 'Roads menu',
  'tool.zoning': 'Zoning menu',
  'tool.services': 'Services menu',
  'tool.brushBigger': 'Bigger brush',
  'tool.brushSmaller': 'Smaller brush',
  'tool.eyedropper': 'Pick building under cursor',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'ui.chat': 'Open command chat',
  'ui.command': 'Open chat with /',
  'ui.toggleHud': 'Hide / show interface',
  'ui.screenshot': 'Take screenshot',
  'ui.photoMode': 'Photo mode',
  'ui.budget': 'Budget & taxes',
  'ui.stats': 'City statistics',
  'ui.overlays': 'Info views',
  'ui.policies': 'Policies',
  'ui.milestones': 'Milestones & achievements',
  'ui.minimap': 'Toggle minimap',
  'ui.search': 'Search buildings',
  'ui.debug': 'Performance overlay',
} as const;
export type ActionId = keyof typeof ACTIONS;

export const DEFAULT_KEYBINDS: Record<ActionId, string[]> = {
  'camera.forward': ['KeyW', 'ArrowUp'],
  'camera.back': ['KeyS', 'ArrowDown'],
  'camera.left': ['KeyA', 'ArrowLeft'],
  'camera.right': ['KeyD', 'ArrowRight'],
  'camera.rotateLeft': ['KeyQ'],
  'camera.rotateRight': ['KeyE'],
  'camera.tiltUp': ['PageUp'],
  'camera.tiltDown': ['PageDown'],
  'camera.zoomIn': ['Equal', 'NumpadAdd'],
  'camera.zoomOut': ['Minus', 'NumpadSubtract'],
  'camera.fast': ['ShiftLeft'],
  'camera.reset': ['Home'],
  'game.pause': ['Space'],
  'game.speed1': ['Digit1'],
  'game.speed2': ['Digit2'],
  'game.speed3': ['Digit3'],
  'game.speed4': ['Digit4'],
  'game.quicksave': ['F5'],
  'game.quickload': ['F9'],
  'tool.cancel': ['Escape'],
  'tool.rotate': ['KeyR'],
  'tool.bulldoze': ['KeyB'],
  'tool.roads': ['KeyN'],
  'tool.zoning': ['KeyZ'],
  'tool.services': ['KeyV'],
  'tool.brushBigger': ['BracketRight'],
  'tool.brushSmaller': ['BracketLeft'],
  'tool.eyedropper': ['KeyI'],
  'edit.undo': ['Ctrl+KeyZ'],
  'edit.redo': ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'],
  'ui.chat': ['KeyT', 'Enter'],
  'ui.command': ['Slash'],
  'ui.toggleHud': ['F1'],
  'ui.screenshot': ['F2'],
  'ui.photoMode': ['KeyP'],
  'ui.budget': ['KeyF'],
  'ui.stats': ['KeyC'],
  'ui.overlays': ['KeyO'],
  'ui.policies': ['KeyL'],
  'ui.milestones': ['KeyU'],
  'ui.minimap': ['KeyM'],
  'ui.search': ['Ctrl+KeyF'],
  'ui.debug': ['F3'],
};

export interface Settings {
  graphics: {
    preset: GraphicsPreset;
    /** chunk radius rendered around the camera focus (2..24) */
    renderDistance: number;
    /** vertical field of view in degrees (30..100) */
    fov: number;
    /** render resolution multiplier (0.5..2) */
    resolutionScale: number;
    shadows: 'off' | 'low' | 'medium' | 'high';
    antialias: boolean;
    bloom: boolean;
    ambientOcclusion: boolean;
    tiltShift: boolean;
    fog: boolean;
    clouds: boolean;
    weatherEffects: boolean;
    /** 0.2..1 multiplier on rendered trees */
    treeDensity: number;
    /** 0.1..1 multiplier on simulated/rendered vehicles */
    vehicleDensity: number;
    pedestrians: boolean;
    buildingDetail: 'low' | 'medium' | 'high';
    /** max frames per second (0 = unlimited/vsync) */
    fpsLimit: number;
    showFps: boolean;
  };
  ui: {
    /** GUI scale (0.6..2) */
    scale: number;
    tooltips: boolean;
    tutorial: boolean;
    clock24h: boolean;
    units: 'metric' | 'imperial';
    /** show chirps (citizen social feed) */
    chirps: boolean;
    /** show problem icons above buildings */
    problemIcons: boolean;
    minimap: boolean;
    /** reduce UI animation */
    reducedMotion: boolean;
  };
  controls: {
    keybinds: Record<ActionId, string[]>;
    edgeScroll: boolean;
    /** 0.2..3 */
    cameraSpeed: number;
    rotateSpeed: number;
    zoomSpeed: number;
    invertY: boolean;
    invertZoom: boolean;
    smoothCamera: boolean;
  };
  audio: {
    master: number;
    music: number;
    ambience: number;
    sfx: number;
    muted: boolean;
  };
  gameplay: {
    /** minutes between autosaves (0 = off) */
    autosaveMinutes: number;
    autosaveSlots: number;
    /** real minutes per full visual day/night cycle at 1x (2..60), 0 = always day */
    dayCycleMinutes: number;
    pauseOnDisaster: boolean;
    autoBulldozeAbandoned: boolean;
    confirmBulldoze: boolean;
    /** show advisor hints */
    advisor: boolean;
  };
}

export function defaultSettings(): Settings {
  return {
    graphics: {
      preset: 'high',
      renderDistance: 10,
      fov: 50,
      resolutionScale: 1,
      shadows: 'medium',
      antialias: true,
      bloom: true,
      ambientOcclusion: false,
      tiltShift: false,
      fog: true,
      clouds: true,
      weatherEffects: true,
      treeDensity: 1,
      vehicleDensity: 1,
      pedestrians: true,
      buildingDetail: 'high',
      fpsLimit: 0,
      showFps: false,
    },
    ui: {
      scale: 1,
      tooltips: true,
      tutorial: true,
      clock24h: true,
      units: 'metric',
      chirps: true,
      problemIcons: true,
      minimap: true,
      reducedMotion: false,
    },
    controls: {
      keybinds: structuredClone(DEFAULT_KEYBINDS),
      edgeScroll: false,
      cameraSpeed: 1,
      rotateSpeed: 1,
      zoomSpeed: 1,
      invertY: false,
      invertZoom: false,
      smoothCamera: true,
    },
    audio: { master: 0.8, music: 0.5, ambience: 0.7, sfx: 0.8, muted: false },
    gameplay: {
      autosaveMinutes: 5,
      autosaveSlots: 3,
      dayCycleMinutes: 8,
      pauseOnDisaster: true,
      autoBulldozeAbandoned: false,
      confirmBulldoze: true,
      advisor: true,
    },
  };
}
