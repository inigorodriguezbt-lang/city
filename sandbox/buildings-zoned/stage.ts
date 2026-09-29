// Shared sandbox stage: renderer, sky-ish environment, sun/hemisphere lights
// for a given hour (the real SkySystem is written in parallel; this emulates it).
import * as THREE from 'three';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  night: number;
  /** fit the sun shadow frustum around a centre/extent */
  fitShadow(cx: number, cz: number, ext: number): void;
}

export function makeStage(canvas: HTMLCanvasElement, hour: number, groundColor: THREE.ColorRepresentation): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: false });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // adapted below once the hour is known
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 9000);

  const sunAng = ((hour - 6) / 12) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(sunAng) * 0.8, Math.sin(sunAng), 0.45).normalize();
  const day = THREE.MathUtils.clamp(Math.sin(sunAng) * 1.6 + 0.15, 0, 1);
  const night = 1 - THREE.MathUtils.smoothstep(Math.sin(sunAng), -0.12, 0.18);
  renderer.toneMappingExposure = 1 + 3 * night; // SkySystem eye adaptation (≈×4 at night)
  const dusk = Math.max(0, 1 - Math.abs(Math.sin(sunAng) - 0.1) * 4) * (1 - night * 0.6);
  const skyTop = new THREE.Color().setRGB(0.012 + 0.3 * day, 0.018 + 0.45 * day, 0.045 + 0.75 * day);
  const skyHor = new THREE.Color().setRGB(0.03 + 0.7 * day + 0.5 * dusk, 0.035 + 0.72 * day + 0.2 * dusk, 0.06 + 0.78 * day);
  scene.background = skyHor.clone().lerp(skyTop, 0.35);
  scene.fog = new THREE.Fog(skyHor.getHex(), 1400, 6500);
  {
    const envScene = new THREE.Scene();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: skyTop }, hor: { value: skyHor }, gnd: { value: new THREE.Color(0.18, 0.17, 0.15).multiplyScalar(0.15 + day * 0.85) }, sunDir: { value: sunDir }, sunI: { value: day * 30 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunDir; uniform float sunI; varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y > 0.0 ? mix(hor, top, pow(d.y, 0.5)) : mix(hor * 0.6, gnd, min(1.0, -d.y * 5.0)); c += vec3(1.0, 0.9, 0.75) * sunI * pow(max(dot(d, sunDir), 0.0), 600.0); gl_FragColor = vec4(c, 1.0); }',
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.85 * (1 - 0.8 * night);
  }
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.93 - dusk * 0.25, 0.84 - dusk * 0.4), 3.2 * day + 0.03);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color(0.6, 0.7, 0.9), 0.5), new THREE.Color(0.25, 0.23, 0.2), 0.08 + 1.2 * day);
  scene.add(hemi);
  if (night > 0.5) {
    const moon = new THREE.DirectionalLight(0x8fa6d8, 0.1);
    moon.position.set(-300, 500, 200);
    scene.add(moon);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  function fitShadow(cx: number, cz: number, ext: number): void {
    const sc = sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 4000;
    sun.target.position.set(cx, 0, cz);
    sun.position.copy(sunDir).multiplyScalar(1800).add(sun.target.position);
    sc.updateProjectionMatrix();
  }
  return { renderer, scene, camera, sun, night, fitShadow };
}
