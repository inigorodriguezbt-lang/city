// SkySystem: time-of-day + weather driven sky, sun/moon lights, shadows,
// fog, environment map (PMREM) and the LightingInfo other renderers read.
import * as THREE from 'three';
import type { World } from '../../world/World';
import type { ThemeDef, WeatherType } from '../../core/types';
import { calendar } from '../../core/time';
import { Atmosphere, moonDirection, sunDirection, THEME_LATITUDE } from './atmosphere';
import { createSkyLutMaterial, createSkyMaterial, createSkyUniforms, SKY_LUT_H, SKY_LUT_W, type SkyUniforms } from './skyShaders';
import type { SharedUniforms } from './SharedUniforms';
import type { LightingInfo } from '../Renderer';

/** Per-weather visual targets (lerped by weather intensity from the "clear" row). */
interface WeatherLook {
  cover: number;
  cirrus: number;
  overcast: number;
  turbidity: number;
  fog: number;
  dark: number;
  /** tint for the overcast dome (1 = neutral) */
  warm: number;
  bright: number;
}

const WEATHER_LOOK: Record<WeatherType, WeatherLook> = {
  clear: { cover: 0.3, cirrus: 0.45, overcast: 0, turbidity: 0.75, fog: 1.0, dark: 0, warm: 0, bright: 0 },
  cloudy: { cover: 0.66, cirrus: 0.25, overcast: 0.32, turbidity: 1.7, fog: 1.35, dark: 0.12, warm: 0, bright: 0 },
  rain: { cover: 0.92, cirrus: 0, overcast: 0.82, turbidity: 2.6, fog: 2.3, dark: 0.42, warm: 0, bright: 0 },
  storm: { cover: 1.0, cirrus: 0, overcast: 0.96, turbidity: 3.2, fog: 2.8, dark: 0.68, warm: 0, bright: 0 },
  snow: { cover: 0.88, cirrus: 0, overcast: 0.8, turbidity: 2.4, fog: 2.6, dark: 0.12, warm: 0, bright: 0.25 },
  fog: { cover: 0.4, cirrus: 0, overcast: 0.62, turbidity: 3.8, fog: 6.5, dark: 0.05, warm: 0, bright: 0.12 },
  heatwave: { cover: 0.04, cirrus: 0.2, overcast: 0, turbidity: 2.3, fog: 1.45, dark: 0, warm: 0.6, bright: 0 },
  blizzard: { cover: 1.0, cirrus: 0, overcast: 1.0, turbidity: 3.4, fog: 7.5, dark: 0.18, warm: 0, bright: 0.35 },
};

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
const SHADOW_MAP: Record<ShadowQuality, number> = { off: 512, low: 1024, medium: 2048, high: 4096 };
const SHADOW_RADIUS: Record<ShadowQuality, number> = { off: 0, low: 650, medium: 1000, high: 1500 };

export interface SkyUpdateContext {
  world: World | null;
  camera: THREE.PerspectiveCamera;
  /** camera focus point (world meters) */
  focus: THREE.Vector3;
  /** orbit distance (m) */
  distance: number;
  /** render radius in meters */
  renderRadius: number;
  fogEnabled: boolean;
  cloudsEnabled: boolean;
  viewportHeight: number;
  dt: number;
  time: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();
const _lz = new THREE.Vector3();

function lum(c: THREE.Color): number {
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}
function approach(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

export class SkySystem {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0x8fb4ff, 0x4a4030, 0.4);
  readonly fog = new THREE.FogExp2(0xa0b8d0, 0.0002);
  readonly skyUniforms: SkyUniforms = createSkyUniforms();
  readonly atm = new Atmosphere();
  /** exposure multiplier suggested by the current light level (eye adaptation) */
  exposure = 1;
  /** current bloom threshold suggestion (lower at night so lights glow) */
  bloomThreshold = 2;
  /** 0..1 how overcast the sky is right now (smoothed) */
  overcast = 0;
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  readonly keyDir = new THREE.Vector3(0, 1, 0);

  private readonly skyMesh: THREE.Mesh;
  private readonly envScene = new THREE.Scene();
  private readonly lutRT: THREE.WebGLRenderTarget;
  private readonly lutMat = createSkyLutMaterial();
  private readonly lutScene = new THREE.Scene();
  private readonly lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly cubeRT: THREE.WebGLCubeRenderTarget;
  private readonly cubeCam: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastLutKey = '';
  private envSunDir = new THREE.Vector3(0, -2, 0);
  private envKey = [-1, -1, -1, -1];
  private envAge = 1e9;
  private envDirty = true;
  private ambientTimer = 0;
  private shadowQuality: ShadowQuality = 'medium';

  // smoothed weather
  private w: WeatherLook = { ...WEATHER_LOOK.clear };
  private wetness = 0;
  private rain = 0;
  private snow = 0;
  private windDir = new THREE.Vector2(1, 0);
  private windSpeed = 4;
  private cloudOffset = new THREE.Vector2(0, 0);
  private initialized = false;

  private readonly sunT = new THREE.Color();
  private readonly moonT = new THREE.Color();
  private readonly zenith = new THREE.Color();
  private readonly skyAmbient = new THREE.Color(0.3, 0.35, 0.45);
  private readonly groundColor = new THREE.Color(0.1, 0.1, 0.08);
  private readonly grassLinear = new THREE.Color();
  private readonly overcastColor = new THREE.Color();
  private readonly nightSky = new THREE.Color();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly lighting: LightingInfo,
    noise: THREE.Texture,
  ) {
    const su = this.skyUniforms;
    su.uNoise.value = noise;
    // share cloud state with other shaders (cloud shadows, water reflections)
    su.uCloudCover = shared.uCloudCover;
    su.uCloudOffset = shared.uCloudOffset;
    su.uTime = shared.uTime;

    this.lutRT = new THREE.WebGLRenderTarget(SKY_LUT_W, SKY_LUT_H, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    su.uLut.value = this.lutRT.texture;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    quad.frustumCulled = false;
    this.lutScene.add(quad);

    const skyGeo = new THREE.PlaneGeometry(2, 2);
    this.skyMesh = new THREE.Mesh(skyGeo, createSkyMaterial(su, false));
    this.skyMesh.name = 'sky';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = 1e6; // after all opaque geometry: only uncovered pixels pay
    this.skyMesh.castShadow = false;
    this.skyMesh.receiveShadow = false;
    this.skyMesh.matrixAutoUpdate = false;
    scene.add(this.skyMesh);

    const envSky = new THREE.Mesh(skyGeo, createSkyMaterial(su, true));
    envSky.frustumCulled = false;
    this.envScene.add(envSky);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.5, 10, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const sun = this.sun;
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 6000;
    scene.add(sun, sun.target, this.hemi);
    scene.fog = this.fog;
    scene.environmentIntensity = 0.7;
  }

  get skyObject(): THREE.Mesh {
    return this.skyMesh;
  }

  setShadowQuality(q: ShadowQuality): void {
    this.shadowQuality = q;
    const sun = this.sun;
    const enabled = q !== 'off';
    if (sun.castShadow !== enabled) sun.castShadow = enabled;
    const size = SHADOW_MAP[q];
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.radius = q === 'high' ? 2.5 : q === 'medium' ? 2 : 1.5;
  }

  /** force the environment map to be regenerated on the next update */
  invalidateEnvironment(): void {
    this.envDirty = true;
  }

  /** jump straight to the current weather/time look on the next update (no blending) */
  snap(): void {
    this.initialized = false;
    this.envDirty = true;
  }

  update(ctx: SkyUpdateContext): void {
    const { world, dt } = ctx;
    const theme: ThemeDef | null = world ? world.theme : null;
    const hour = world ? world.time.hour : 10.5;
    const day = world ? world.time.day : 100;
    const cal = calendar(day);
    const yp = cal.yearProgress + ((day % 1) + 1) % 1 / 360;
    const lat = theme ? THEME_LATITUDE[theme.id] : 42;
    if (theme) {
      // average ground albedo for bounce light: arid biomes read as dry grass and sand
      const arid = 1 - theme.rainfall;
      this.grassLinear.set(theme.grass).lerp(_c.set(theme.grassDry), arid * 0.8).lerp(_c.set(theme.sand), arid * arid * 0.6);
    } else this.grassLinear.setRGB(0.12, 0.2, 0.07);

    // ── weather smoothing ─────────────────────────────────────────────────
    const weather = world?.weather;
    const type: WeatherType = weather?.type ?? 'clear';
    const intensity = weather ? Math.min(1, Math.max(0, weather.intensity)) : 0;
    const target = WEATHER_LOOK[type];
    const base = WEATHER_LOOK.clear;
    const k = type === 'clear' ? 1 : 0.55 + 0.45 * intensity;
    const snap = !this.initialized;
    const rate = snap ? 1e9 : 0.35;
    const lw = this.w;
    (Object.keys(lw) as (keyof WeatherLook)[]).forEach((key) => {
      const tv = base[key] + (target[key] - base[key]) * k;
      lw[key] = approach(lw[key], tv, rate, dt);
    });
    this.overcast = lw.overcast;
    const raining = type === 'rain' || type === 'storm';
    this.rain = approach(this.rain, raining ? 0.35 + 0.65 * intensity : 0, snap ? 1e9 : 0.8, dt);
    const wetTarget = raining ? 1 : type === 'snow' || type === 'blizzard' ? 0.35 : 0;
    this.wetness = approach(this.wetness, wetTarget, snap ? 1e9 : wetTarget > this.wetness ? 0.25 : 0.02, dt);
    this.snow = approach(this.snow, weather?.snowCover ?? 0, snap ? 1e9 : 0.5, dt);
    const wd = weather?.windDir ?? 0.6;
    _v.set(Math.cos(wd), 0, Math.sin(wd));
    this.windDir.set(approach(this.windDir.x, _v.x, snap ? 1e9 : 0.5, dt), approach(this.windDir.y, _v.z, snap ? 1e9 : 0.5, dt));
    if (this.windDir.lengthSq() < 1e-6) this.windDir.set(1, 0);
    this.windDir.normalize();
    this.windSpeed = approach(this.windSpeed, weather?.windSpeed ?? 4, snap ? 1e9 : 0.5, dt);
    // clouds drift with the wind (cloud decks move faster than surface wind)
    this.cloudOffset.addScaledVector(this.windDir, -(this.windSpeed * 3.2 + 6) * dt);
    this.shared.uCloudOffset.value.copy(this.cloudOffset);
    this.shared.uCloudCover.value = lw.cover;
    this.shared.uWindDir.value.copy(this.windDir);
    this.shared.uWindSpeed.value = this.windSpeed;
    this.shared.uWetness.value = this.wetness;
    this.shared.uRain.value = this.rain;
    this.shared.uSnow.value = this.snow;

    // ── sun & moon ────────────────────────────────────────────────────────
    const sunDir = this.lighting.sunDir;
    sunDirection(hour, yp, lat, sunDir);
    const phase = moonDirection(hour, day, yp, lat, this.moonDir);
    const atm = this.atm;
    atm.sunDir.copy(sunDir);
    atm.params.turbidity = lw.turbidity;
    atm.transmittanceAt(sunDir, 0.25, this.sunT);
    atm.transmittanceAt(this.moonDir, 0.25, this.moonT);
    const sunUp = THREE.MathUtils.smoothstep(sunDir.y, -0.035, 0.03);
    const moonIllum = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    const moonUp = THREE.MathUtils.smoothstep(this.moonDir.y, -0.03, 0.06);
    const clouded = 1 - 0.84 * lw.overcast;
    const sunIntensity = 3.6 * sunUp * clouded;
    // stylised moonlight: brighter than physical so moonlit nights stay readable
    const moonIntensity = 0.78 * (0.3 + 0.7 * moonIllum) * moonUp * (1 - 0.85 * lw.overcast) * (1 - sunUp);

    const daylight = THREE.MathUtils.smoothstep(sunDir.y, -0.1, 0.3) * (1 - 0.35 * lw.overcast);
    let night = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.075, 0.07);
    night = Math.max(night, THREE.MathUtils.smoothstep(lw.dark + lw.overcast * 0.3, 0.75, 1.1) * 0.6);
    this.lighting.daylight = daylight;
    this.lighting.night = night;
    this.shared.uNight.value = night;

    // key light: the sun while it is (nearly) up, otherwise the moon
    const useSun = sunDir.y > -0.05 || sunIntensity * lum(this.sunT) > moonIntensity;
    const keyDir = this.keyDir.copy(useSun ? sunDir : this.moonDir);
    const keyColor = _c.copy(useSun ? this.sunT : this.moonT);
    if (!useSun) keyColor.multiply(_c2.setRGB(0.62, 0.74, 1.0));
    const keyIntensity = useSun ? sunIntensity : moonIntensity;
    this.lighting.sunColor.copy(keyColor).multiplyScalar(keyIntensity);
    this.shared.uSunDir.value.copy(keyDir);
    this.shared.uSunColor.value.copy(this.lighting.sunColor);

    // ── LUT bake (only when the sun elevation / haze changed) ─────────────
    const lutKey = `${sunDir.y.toFixed(4)}|${lw.turbidity.toFixed(3)}`;
    if (lutKey !== this.lastLutKey) {
      this.lastLutKey = lutKey;
      const el = Math.asin(Math.max(-1, Math.min(1, sunDir.y)));
      this.lutMat.uniforms.uSunDir.value.set(Math.cos(el), Math.sin(el), 0);
      this.lutMat.uniforms.uTurbidity.value = lw.turbidity;
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.lutRT);
      this.renderer.render(this.lutScene, this.lutCam);
      this.renderer.setRenderTarget(prev);
    }

    // ── ambient / zenith (throttled; cheap but not free) ─────────────────
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0 || snap) {
      this.ambientTimer = 0.15;
      atm.radiance(_v.set(0, 1, 0), this.zenith);
      const amb = _c2.setRGB(0, 0, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        atm.radiance(_v.set(Math.cos(a) * 0.82, 0.57, Math.sin(a) * 0.82), _c);
        amb.add(_c);
      }
      amb.multiplyScalar(1 / 6).lerp(this.zenith, 0.3);
      this.skyAmbient.copy(amb);
    }
    // night floor: moonlit / airglow sky so night is readable, not black
    this.nightSky.setRGB(0.0038, 0.007, 0.0165).multiplyScalar(1 + 3.0 * moonIllum * moonUp);
    const ambient = this.lighting.ambientColor.copy(this.skyAmbient).add(_c.copy(this.nightSky).multiplyScalar(6));
    // eye adaptation follows the physical ambient (the night boost above is a stylistic lift)
    const adaptScale = (lum(this.skyAmbient) + lum(this.nightSky) * 3) / Math.max(1e-6, lum(this.skyAmbient) + lum(this.nightSky) * 6);
    // overcast greys the ambient, keeps most of its energy
    const ambLum = lum(ambient);
    const bright = 1 + lw.bright;
    this.overcastColor.setRGB(ambLum * 1.05, ambLum * 1.08, ambLum * 1.14).multiplyScalar(bright * (1 - lw.dark * 0.55));
    if (lw.warm > 0) this.overcastColor.lerp(_c.setRGB(ambLum * 1.2, ambLum * 1.0, ambLum * 0.75), lw.warm * 0.5);
    ambient.lerp(this.overcastColor, lw.overcast);

    // ground bounce colour (for env lower hemisphere + hemisphere light)
    const sunIrr = sunIntensity * Math.max(0, sunDir.y) * 0.9;
    this.groundColor.copy(this.grassLinear).multiplyScalar(0.6).multiply(_c.copy(this.sunT).multiplyScalar(sunIrr / Math.PI).add(ambient)).multiplyScalar(0.9);
    if (this.snow > 0.05) this.groundColor.lerp(_c.copy(ambient).multiplyScalar(0.9), this.snow * 0.6);

    // ── fog ───────────────────────────────────────────────────────────────
    const cam = ctx.camera;
    cam.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
    _v.normalize().multiplyScalar(0.9995);
    _v.y = 0.03;
    // horizon radiance around the view azimuth (averaged to soften the Mie
    // peak toward the sun), toned down toward the sky ambient
    const fogCol = atm.radiance(_v, _c);
    const ax = _v.x, az = _v.z;
    for (const a of [-0.9, 0.9]) {
      _v.set(ax * Math.cos(a) - az * Math.sin(a), 0.03, ax * Math.sin(a) + az * Math.cos(a));
      fogCol.add(atm.radiance(_v, _c2));
    }
    fogCol.multiplyScalar(1 / 3 * 0.7).lerp(_c2.copy(this.skyAmbient).multiplyScalar(1.1), 0.25);
    const fogLum = lum(fogCol), capLum = lum(this.skyAmbient) * 1.8 + 0.02;
    if (fogLum > capLum) fogCol.multiplyScalar(capLum / fogLum);
    fogCol.add(_c2.copy(this.nightSky).multiplyScalar(2.2));
    const cityGlow = world ? Math.min(1, Math.log10(world.stats.population + 10) / 6) : 0;
    this.skyUniforms.uCityGlow.value.setRGB(0.07, 0.042, 0.02).multiplyScalar(cityGlow * night * (1 + lw.overcast * 1.5));
    fogCol.add(_c2.copy(this.skyUniforms.uCityGlow.value).multiplyScalar(0.5));
    fogCol.lerp(_c2.copy(this.overcastColor).multiplyScalar(0.95), Math.min(1, lw.overcast * 0.9 + (lw.fog > 3 ? 0.4 : 0)));
    this.fog.color.copy(fogCol);
    // density: near view stays crisp, the render radius edge fades out
    const dist = Math.max(ctx.distance, 40);
    const radius = Math.max(ctx.renderRadius, 1500);
    let density = Math.min(0.3 / dist, 0.85 / (dist + radius));
    density *= ctx.fogEnabled ? 1 : 0.45;
    density *= Math.sqrt(lw.fog);
    if (lw.fog > 2) density = Math.max(density, (lw.fog - 2) * 0.00011 * (ctx.fogEnabled ? 1 : 0.6));
    this.fog.density = density;

    // ── sky uniforms ──────────────────────────────────────────────────────
    const su = this.skyUniforms;
    su.uSunDir.value.copy(sunDir);
    su.uSunDisc.value.copy(this.sunT).multiplyScalar(45 * sunUp);
    su.uMoonDir.value.copy(this.moonDir);
    su.uMoonColor.value.copy(this.moonT).multiply(_c2.setRGB(0.95, 0.97, 1.0)).multiplyScalar(0.06 * moonUp);
    su.uMoonGlow.value = (0.3 + 0.7 * moonIllum) * (1 - sunUp) * (1 + lw.turbidity * 0.3);
    su.uNightSky.value.copy(this.nightSky);
    // stars only once civil twilight is over (sun ~4-11 degrees below the horizon)
    const starNight = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.19, -0.07);
    su.uStars.value = starNight * (1 - lw.overcast) * (1 - 0.55 * moonIllum * moonUp) * (1 - 0.5 * cityGlow) * (1 - Math.min(1, (lw.fog - 1) * 0.3));
    _v2.set(0, Math.sin(lat * Math.PI / 180), -Math.cos(lat * Math.PI / 180));
    _m4.makeRotationAxis(_v2, ((hour / 24) + yp) * Math.PI * 2);
    su.uStarRot.value.setFromMatrix4(_m4);
    su.uPixelAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, ctx.viewportHeight);
    su.uOvercast.value = lw.overcast;
    su.uOvercastColor.value.copy(this.overcastColor);
    su.uFogColor.value.copy(fogCol);
    su.uHorizonFog.value = Math.min(1, 0.35 + density * 900 + (lw.fog > 3 ? 0.4 : 0));
    su.uHorizonFalloff.value = lw.fog > 3 ? 4 : 14;
    su.uCloudsOn.value = ctx.cloudsEnabled ? 1 : 0;
    su.uCloudHeight.value = Math.max(2200, cam.position.y + 1500);
    su.uCloudLightDir.value.copy(keyDir.y < 0.02 ? _v2.copy(keyDir).setY(0.02).normalize() : keyDir);
    atm.transmittanceAt(keyDir, 2.2, _c2);
    su.uCloudSun.value.copy(_c2).multiplyScalar(useSun ? 1.6 * THREE.MathUtils.smoothstep(sunDir.y, -0.06, 0.02) : 0.035 * moonIllum * moonUp);
    su.uCloudAmbient.value.copy(ambient).multiplyScalar(0.95).add(_c2.copy(su.uCityGlow.value).multiplyScalar(0.8));
    su.uCloudDark.value = lw.dark;
    su.uCirrus.value = lw.cirrus;
    su.uGroundColor.value.copy(this.groundColor);

    // ── lights ────────────────────────────────────────────────────────────
    const sun = this.sun;
    sun.color.copy(keyColor);
    sun.intensity = keyIntensity;
    this.hemi.color.copy(ambient).multiplyScalar(1 / Math.max(1e-3, Math.max(ambient.r, ambient.g, ambient.b)));
    this.hemi.groundColor.copy(this.groundColor).multiplyScalar(1 / Math.max(1e-3, Math.max(this.groundColor.r, this.groundColor.g, this.groundColor.b, 1e-3)));
    // sky irradiance reaches PBR/Lambert/Phong materials through scene.environment (IBL);
    // the hemisphere light is only a small fill for materials without IBL
    this.hemi.intensity = lum(ambient) * 0.35 + 0.012;
    this.fitShadow(ctx, keyDir);

    // exposure & bloom adaptation
    const lightLevel = sunIntensity * Math.max(0.15, sunDir.y) + lum(ambient) * adaptScale * 3;
    this.exposure = THREE.MathUtils.clamp(0.95 / Math.pow(Math.max(lightLevel, 0.02) / 2.2, 0.28), 0.9, 3.4) * (1 + 0.22 * night);
    this.bloomThreshold = THREE.MathUtils.lerp(3.2, 0.9, night);

    // ── environment map ───────────────────────────────────────────────────
    this.envAge += dt;
    const key = [lw.overcast, lw.cover, night, this.snow];
    const sunMove = this.envSunDir.angleTo(sunDir);
    let changed = this.envDirty || sunMove > 0.035;
    let big = sunMove > 0.15;
    for (let i = 0; i < key.length; i++) {
      const dk = Math.abs(key[i] - this.envKey[i]);
      if (dk > 0.04) changed = true;
      if (dk > 0.25) big = true;
    }
    if (changed && (this.envAge > 0.8 || this.envDirty || big)) {
      this.envDirty = false;
      this.envAge = 0;
      this.envSunDir.copy(sunDir);
      this.envKey = key;
      this.cubeCam.update(this.renderer, this.envScene);
      this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
      this.scene.environment = this.envRT.texture;
    }
    this.initialized = true;
  }

  /** fit the directional shadow camera around the view focus (texel-snapped) */
  private fitShadow(ctx: SkyUpdateContext, keyDir: THREE.Vector3): void {
    const sun = this.sun;
    if (this.shadowQuality === 'off') return;
    const maxR = SHADOW_RADIUS[this.shadowQuality];
    const R = THREE.MathUtils.clamp(ctx.distance * 1.15 + 60, 90, maxR);
    // bias the box toward what the camera looks at
    ctx.camera.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() > 1e-6) _v.normalize();
    const center = _v2.copy(ctx.focus).addScaledVector(_v, R * 0.3);
    // clamp elevation: grazing light gives unusable, shimmering shadows
    const dir = _v.copy(keyDir);
    if (dir.y < 0.14) {
      dir.y = 0;
      dir.normalize().multiplyScalar(Math.sqrt(1 - 0.14 * 0.14));
      dir.y = 0.14;
    }
    const cam = sun.shadow.camera;
    const texel = (2 * R) / sun.shadow.mapSize.x;
    // snap the centre in light space to whole texels to avoid shimmering
    const lz = _lz.copy(dir).negate();
    const lx = _lx.set(0, 1, 0).cross(lz);
    if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0);
    lx.normalize();
    const ly = _ly.copy(lz).cross(lx).normalize();
    const cx = Math.round(center.dot(lx) / texel) * texel;
    const cy = Math.round(center.dot(ly) / texel) * texel;
    const cz = center.dot(lz);
    center.set(0, 0, 0).addScaledVector(lx, cx).addScaledVector(ly, cy).addScaledVector(lz, cz);
    const back = R * 1.5 + 900;
    sun.position.copy(center).addScaledVector(dir, back);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    cam.left = -R;
    cam.right = R;
    cam.top = R;
    cam.bottom = -R;
    cam.near = 1;
    cam.far = back + R * 1.5 + 600;
    cam.updateProjectionMatrix();
    sun.shadow.normalBias = texel * 1.1;
    sun.shadow.bias = -0.00025;
  }

  dispose(): void {
    this.lutRT.dispose();
    this.lutMat.dispose();
    this.cubeRT.dispose();
    this.pmrem.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    (this.skyMesh.material as THREE.Material).dispose();
    this.skyMesh.geometry.dispose();
    this.scene.remove(this.skyMesh, this.sun, this.sun.target, this.hemi);
    this.scene.environment = null;
    this.sun.shadow.map?.dispose();
  }
}
