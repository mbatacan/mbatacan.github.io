// The 3D scene: ocean swell, sky, two procedural OC6 canoes, and a chase/top-down camera.
// Browser-only (imports three and touches the DOM), loaded dynamically by the lab page so it
// never runs during Astro's static build. Waves are cosmetic (see ../../lib/ama-flow/waves.ts);
// nothing here feeds back into the physics.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { canoeOutlines, HULL_LENGTH_M } from '../../lib/ama-flow/canoe-geometry';
import { defaultSwell, waveHeight, waveSlope, type WaveComponent } from '../../lib/ama-flow/waves';

export type CameraMode = 'chase' | 'top';
export type BoatId = 'player' | 'opponent';

interface BoatVisual {
  group: THREE.Group;
  paddle: THREE.Group; // the steersman's paddle -- the only crew member the game controls
}

// Body-frame x of each seat, stern (steersman, seat 6) to bow (seat 1) -- mirrors the "steersman
// sits about 5m aft of CG" note in ama-flow's oc6_stroke_config().
const SEAT_X_POSITIONS = [5, 3, 1, -1, -3, -5];
const CREW_SHIRT_COLOR = 0xff8c00;
const CREW_SKIN_COLOR = 0xd8a878;
const SEAT_HEIGHT_M = 0.85;

const STROKE_TYPE_KEYS = ['forward', 'draw', 'poke', 'rudder'] as const;
const PADDLE_COLORS: Record<(typeof STROKE_TYPE_KEYS)[number], number> = {
  forward: 0x6b4423,
  draw: 0x3aa0c8,
  poke: 0xe07a2e,
  rudder: 0xd43c3c,
};

const OCEAN_SIZE_M = 500;
const OCEAN_SEGMENTS = 140;
const HULL_COLORS: Record<BoatId, number> = { player: 0x8b8bff, opponent: 0xe05a5a };
const AMA_COLOR = 0xd2b48c;
const IAKO_COLOR = 0x8c8c8c;
// Both boats run identical physics from (0, 0), so without this they'd render exactly on top of
// each other. This offset is visual only -- applied to the mesh, never to the simulated state.
const BOAT_LANE_OFFSET_M: Record<BoatId, number> = { player: 5, opponent: -5 };
const FINISH_LINE_HALF_WIDTH_M = 15;
const FINISH_BUOY_HEIGHT_M = 3;

/** A checkered finish gate: two buoy poles and a bright line between them, so the race has a
 * visible endpoint instead of just running out over open, featureless water.
 */
function buildFinishLine(distanceM: number): THREE.Group {
  const group = new THREE.Group();
  const lineGeometry = new THREE.BoxGeometry(0.3, 0.05, FINISH_LINE_HALF_WIDTH_M * 2);
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe14d,
    emissive: 0x554400,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.y = 0.05;
  group.add(line);

  const buoyGeometry = new THREE.CylinderGeometry(0.4, 0.4, FINISH_BUOY_HEIGHT_M, 12);
  const buoyMaterial = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x330000 });
  for (const z of [FINISH_LINE_HALF_WIDTH_M, -FINISH_LINE_HALF_WIDTH_M]) {
    const buoy = new THREE.Mesh(buoyGeometry, buoyMaterial);
    buoy.position.set(0, FINISH_BUOY_HEIGHT_M / 2, z);
    group.add(buoy);
  }

  group.position.x = distanceM;
  return group;
}

function shapeFromOutline(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

/** One paddler: a capsule torso plus a sphere head, bright enough to read clearly against the
 * dark hull. Purely decorative -- seats 1-5 never move, since only the steersman (seat 6) is
 * an actual action in the physics.
 */
function buildCrewFigure(): THREE.Group {
  const figure = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.5, 4, 8),
    new THREE.MeshStandardMaterial({ color: CREW_SHIRT_COLOR }),
  );
  torso.position.y = 0.35;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshStandardMaterial({ color: CREW_SKIN_COLOR }),
  );
  head.position.y = 0.75;
  figure.add(torso, head);
  return figure;
}

/** The steersman's paddle: a shaft and blade, positioned to whichever side is currently
 * paddling and colored by stroke type -- read setStroke() for how it's animated per stroke.
 */
function buildSteersmanPaddle(): THREE.Group {
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: PADDLE_COLORS.forward }),
  );
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.5, 0.22),
    new THREE.MeshStandardMaterial({ color: PADDLE_COLORS.forward }),
  );
  blade.position.y = -0.9;
  paddle.add(shaft, blade);
  paddle.userData.blade = blade;
  paddle.userData.shaft = shaft;
  return paddle;
}

/** A low-poly OC6 glyph: hull, ama, two iako, six paddlers, and the steersman's paddle, laid on
 * the water plane. Body-frame +x is forward; the mesh is built in the X-Z plane (Y up) so a
 * Y-axis rotation by heading psi orients it exactly as ama_flow's own top-down glyph would (sim
 * +y/port -> -Z).
 */
function buildCanoeMesh(hullColor: number): BoatVisual {
  const outlines = canoeOutlines();
  const group = new THREE.Group();

  function addPart(points: [number, number][], color: number, height: number, yOffset: number) {
    const shape = shapeFromOutline(points.map(([x, y]) => [x, -y] as [number, number]));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2); // extrude along Y after building flat in X-Z
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    mesh.position.y = yOffset;
    group.add(mesh);
  }

  addPart(outlines.hull, hullColor, 0.5, 0);
  addPart(outlines.ama, AMA_COLOR, 0.25, 0.05);
  addPart(outlines.forwardIako, IAKO_COLOR, 0.08, 0.35);
  addPart(outlines.aftIako, IAKO_COLOR, 0.08, 0.35);

  for (const x of SEAT_X_POSITIONS) {
    const figure = buildCrewFigure();
    figure.position.set(x, SEAT_HEIGHT_M, 0);
    group.add(figure);
  }

  const paddle = buildSteersmanPaddle();
  const steersmanX = SEAT_X_POSITIONS[SEAT_X_POSITIONS.length - 1];
  paddle.position.set(steersmanX, SEAT_HEIGHT_M + 0.5, 0);
  group.add(paddle);

  return { group, paddle };
}

const OCEAN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAmplitude;
  uniform vec3 uWavenumber;
  uniform vec3 uAngularSpeed;
  uniform vec2 uDirection0;
  uniform vec2 uDirection1;
  uniform vec2 uDirection2;
  uniform vec2 uWorldOffset;
  varying float vHeight;
  varying vec3 vNormal;

  float phaseOf(vec2 dir, float k, float w, vec2 pos) {
    return k * dot(dir, pos) - w * uTime;
  }

  void main() {
    // The plane is built flat in local XY, then the mesh is rotated -90 deg about X so local
    // (x, y) -> world (x, z) = (x, -y). The mesh is also recentered under the camera every
    // frame (an "infinite ocean" -- see AmaFlowScene.render) since it's a finite 500m plane
    // and a race can cover more ground than that; uWorldOffset is the mesh's current world
    // position, added back in so the wave pattern samples true world coordinates and stays
    // continuous as the mesh slides under the boats.
    vec2 pos = vec2(position.x, -position.y) + uWorldOffset;
    float h = 0.0;
    float dx = 0.0;
    float dz = 0.0;

    float p0 = phaseOf(uDirection0, uWavenumber.x, uAngularSpeed.x, pos);
    h += uAmplitude.x * sin(p0);
    float s0 = uAmplitude.x * uWavenumber.x * cos(p0);
    dx += s0 * uDirection0.x;
    dz += s0 * uDirection0.y;

    float p1 = phaseOf(uDirection1, uWavenumber.y, uAngularSpeed.y, pos);
    h += uAmplitude.y * sin(p1);
    float s1 = uAmplitude.y * uWavenumber.y * cos(p1);
    dx += s1 * uDirection1.x;
    dz += s1 * uDirection1.y;

    float p2 = phaseOf(uDirection2, uWavenumber.z, uAngularSpeed.z, pos);
    h += uAmplitude.z * sin(p2);
    float s2 = uAmplitude.z * uWavenumber.z * cos(p2);
    dx += s2 * uDirection2.x;
    dz += s2 * uDirection2.y;

    vHeight = h;
    vNormal = normalize(vec3(-dx, 1.0, -dz));
    vec3 displaced = vec3(position.x, position.y, h);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  varying float vHeight;
  varying vec3 vNormal;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSunDirection;

  void main() {
    float mixAmount = clamp(vHeight * 1.5 + 0.5, 0.0, 1.0);
    vec3 base = mix(uDeepColor, uShallowColor, mixAmount);
    float diffuse = clamp(dot(normalize(vNormal), normalize(uSunDirection)), 0.0, 1.0);
    vec3 color = base * (0.6 + 0.4 * diffuse);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class AmaFlowScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private ocean: THREE.Mesh;
  private oceanMaterial: THREE.ShaderMaterial;
  private waves: WaveComponent[];
  private boats: Record<BoatId, BoatVisual>;
  private cameraMode: CameraMode = 'chase';
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3(0, 20, -30);

  constructor(canvas: HTMLCanvasElement, windDirectionRad: number, finishDistanceM: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Sky's shader outputs HDR-ish values; without tone mapping it clips straight to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.35;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(50, 80, -30);
    this.scene.add(sun, new THREE.AmbientLight(0x404060, 1.2));

    const sky = new Sky();
    sky.scale.setScalar(4000);
    sky.material.uniforms.turbidity.value = 1;
    sky.material.uniforms.rayleigh.value = 2.5;
    sky.material.uniforms.mieCoefficient.value = 0.003;
    sky.material.uniforms.mieDirectionalG.value = 0.8;
    sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();
    this.scene.add(sky);

    this.waves = defaultSwell(windDirectionRad);
    this.oceanMaterial = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX_SHADER,
      fragmentShader: OCEAN_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: new THREE.Vector3(...this.waves.map((w) => w.amplitude)) },
        uWavenumber: { value: new THREE.Vector3(...this.waves.map((w) => w.wavenumber)) },
        uAngularSpeed: { value: new THREE.Vector3(...this.waves.map((w) => w.angularSpeed)) },
        uDirection0: { value: new THREE.Vector2(...this.waves[0].direction) },
        uDirection1: { value: new THREE.Vector2(...this.waves[1].direction) },
        uDirection2: { value: new THREE.Vector2(...this.waves[2].direction) },
        uDeepColor: { value: new THREE.Vector3(0.02, 0.12, 0.25) },
        uShallowColor: { value: new THREE.Vector3(0.05, 0.35, 0.45) },
        uSunDirection: { value: sun.position.clone().normalize() },
        uWorldOffset: { value: new THREE.Vector2(0, 0) },
      },
    });
    const oceanGeometry = new THREE.PlaneGeometry(
      OCEAN_SIZE_M,
      OCEAN_SIZE_M,
      OCEAN_SEGMENTS,
      OCEAN_SEGMENTS,
    );
    this.ocean = new THREE.Mesh(oceanGeometry, this.oceanMaterial);
    this.ocean.rotation.x = -Math.PI / 2;
    this.scene.add(this.ocean);

    this.boats = {
      player: buildCanoeMesh(HULL_COLORS.player),
      opponent: buildCanoeMesh(HULL_COLORS.opponent),
    };
    this.scene.add(this.boats.player.group, this.boats.opponent.group);
    this.scene.add(buildFinishLine(finishDistanceM));

    this.resize();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  /** Place a boat at world (x, y) [ama-flow's sim frame] and heading psi (rad), resting on the
   * cosmetic swell at elapsedSeconds.
   */
  setBoatState(which: BoatId, x: number, y: number, psi: number, elapsedSeconds: number): void {
    const threeX = x;
    const threeZ = -y + BOAT_LANE_OFFSET_M[which];
    const height = waveHeight(this.waves, threeX, threeZ, elapsedSeconds);
    const [slopeX, slopeZ] = waveSlope(this.waves, threeX, threeZ, elapsedSeconds);
    const group = this.boats[which].group;
    group.position.set(threeX, height, threeZ);
    group.rotation.set(0, psi, 0);
    // Small pitch/roll from the local wave slope along the boat's forward/lateral axes.
    group.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.atan(slopeX) * 0.4);
    group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), Math.atan(slopeZ) * 0.4);
  }

  /** Animate the steersman's paddle for the current stroke: which side (0 = port, 1 =
   * starboard), which of the four stroke types, and phase in [0, 1) for progress through it.
   * This is the one crew member the game actually controls, so it's the one worth animating.
   */
  setStroke(which: BoatId, side: number, strokeType: number, phase: number): void {
    const paddle = this.boats[which].paddle;
    const sideSign = side === 0 ? -1 : 1; // port -> local -Z, starboard -> local +Z
    const swing = Math.sin(Math.min(phase, 1) * Math.PI); // 0 at catch/release, peak mid-stroke
    paddle.position.z = sideSign * (0.55 + 0.15 * swing);
    paddle.rotation.z = sideSign * 0.5;
    paddle.rotation.x = -0.3 + 0.5 * swing;

    const key = STROKE_TYPE_KEYS[strokeType] ?? 'forward';
    const color = PADDLE_COLORS[key];
    const blade = paddle.userData.blade as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const shaft = paddle.userData.shaft as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    blade.material.color.setHex(color);
    shaft.material.color.setHex(color);
  }

  /** Advance wave time and the camera, then render one frame. */
  render(elapsedSeconds: number, focus: BoatId): void {
    this.oceanMaterial.uniforms.uTime.value = elapsedSeconds;
    const focused = this.boats[focus].group.position;

    if (this.cameraMode === 'top') {
      const desiredPos = new THREE.Vector3(focused.x, 90, focused.z + 0.001);
      const desiredTarget = focused.clone();
      this.cameraPosition.lerp(desiredPos, 0.08);
      this.cameraTarget.lerp(desiredTarget, 0.08);
    } else {
      const forward = new THREE.Vector3(0, 0, HULL_LENGTH_M).applyEuler(
        this.boats[focus].group.rotation,
      );
      const desiredPos = focused.clone().sub(forward.multiplyScalar(1.6)).add(
        new THREE.Vector3(0, 9, 0),
      );
      this.cameraPosition.lerp(desiredPos, 0.08);
      this.cameraTarget.lerp(focused, 0.08);
    }
    this.camera.position.copy(this.cameraPosition);
    // lookAt is degenerate when the view direction is (anti)parallel to camera.up -- exactly
    // the top-down case (looking straight down with up = +Y). Use a level up vector there
    // instead, or half the frame renders as an undefined, unlit mess.
    this.camera.up.set(0, this.cameraMode === 'top' ? 0 : 1, this.cameraMode === 'top' ? -1 : 0);
    this.camera.lookAt(this.cameraTarget);

    // Recenter the (finite, 500m) ocean plane under the camera every frame -- an "infinite
    // ocean" trick -- so a race that covers more ground than that never sails off the edge into
    // empty space. The vertex shader samples the swell using this offset so the pattern stays
    // continuous as the mesh slides underneath it.
    this.ocean.position.set(this.cameraPosition.x, 0, this.cameraPosition.z);
    this.oceanMaterial.uniforms.uWorldOffset.value.set(this.ocean.position.x, this.ocean.position.z);

    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
