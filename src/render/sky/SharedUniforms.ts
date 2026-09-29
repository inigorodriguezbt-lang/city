// Uniforms shared by every render-core shader (and available to other renderers
// through `GameRenderer.shared`). Values are refreshed once per frame by the
// SkySystem / GameRenderer, so any material that references these objects gets
// live time, wind, sun and weather state for free.
import * as THREE from 'three';

export interface SharedUniforms {
  [k: string]: THREE.IUniform;
  /** real seconds since the renderer started (ambient animation: waves, clouds, sway) */
  uTime: { value: number };
  /** normalized wind direction on the XZ plane (x → +X, y → +Z) */
  uWindDir: { value: THREE.Vector2 };
  /** wind speed m/s (smoothed) */
  uWindSpeed: { value: number };
  /** normalized world direction TOWARD the key light (sun by day, moon by night) */
  uSunDir: { value: THREE.Vector3 };
  /** key light radiance (color × intensity, linear) */
  uSunColor: { value: THREE.Color };
  /** 0 = day, 1 = night */
  uNight: { value: number };
  /** 0..1 surface wetness (rain / storm / after rain) */
  uWetness: { value: number };
  /** 0..1 rain intensity right now (ripples, darkening) */
  uRain: { value: number };
  /** 0..1 snow cover on the ground (world.weather.snowCover, smoothed) */
  uSnow: { value: number };
  /** tileable RGBA noise (R: low fbm, G: mid fbm, B: ridged, A: fine fbm) */
  uNoise: { value: THREE.Texture | null };
  /** map extent in meters (size * CELL) */
  uMapSize: { value: number };
  /** 0..1 info-view (overlay) strength */
  uInfoView: { value: number };
  /** cloud deck coverage 0..1 and drift offset (m) — see CLOUD_GLSL */
  uCloudCover: { value: number };
  uCloudOffset: { value: THREE.Vector2 };
  /** nominal sea level and current flood offset (m) */
  uSeaLevel: { value: number };
  uFlood: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindSpeed: { value: 4 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uNight: { value: 0 },
    uWetness: { value: 0 },
    uRain: { value: 0 },
    uSnow: { value: 0 },
    uNoise: { value: null },
    uMapSize: { value: 4096 },
    uInfoView: { value: 0 },
    uCloudCover: { value: 0.2 },
    uCloudOffset: { value: new THREE.Vector2() },
    uSeaLevel: { value: 0 },
    uFlood: { value: 0 },
  };
}
