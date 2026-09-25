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
}

const OCEAN_SIZE_M = 500;
const OCEAN_SEGMENTS = 140;
const HULL_COLORS: Record<BoatId, number> = { player: 0x8b8bff, opponent: 0xe05a5a };
const AMA_COLOR = 0xd2b48c;
const IAKO_COLOR = 0x8c8c8c;

function shapeFromOutline(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

/** A low-poly OC6 glyph: hull, ama, and two iako, extruded flat and laid on the water plane.
 * Body-frame +x is forward; the mesh is built in the X-Z plane (Y up) so a Y-axis rotation by
 * heading psi orients it exactly as ama_flow's own top-down glyph would (sim +y/port -> -Z).
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

  return { group };
}

const OCEAN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAmplitude;
  uniform vec3 uWavenumber;
  uniform vec3 uAngularSpeed;
  uniform vec2 uDirection0;
  uniform vec2 uDirection1;
  uniform vec2 uDirection2;
  varying float vHeight;
  varying vec3 vNormal;

  float phaseOf(vec2 dir, float k, float w, vec2 pos) {
    return k * dot(dir, pos) - w * uTime;
  }

  void main() {
    // The plane is built flat in local XY, then the mesh is rotated -90 deg about X so local
    // (x, y) -> world (x, z) = (x, -y). Sample the swell in that world (X, Z) frame so it lines
    // up with the boats, which are placed directly in world coordinates.
    vec2 pos = vec2(position.x, -position.y);
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

  constructor(canvas: HTMLCanvasElement, windDirectionRad: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(50, 80, -30);
    this.scene.add(sun, new THREE.AmbientLight(0x404060, 1.2));

    const sky = new Sky();
    sky.scale.setScalar(4000);
    sky.material.uniforms.turbidity.value = 4;
    sky.material.uniforms.rayleigh.value = 2;
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
    const threeZ = -y;
    const height = waveHeight(this.waves, threeX, threeZ, elapsedSeconds);
    const [slopeX, slopeZ] = waveSlope(this.waves, threeX, threeZ, elapsedSeconds);
    const group = this.boats[which].group;
    group.position.set(threeX, height, threeZ);
    group.rotation.set(0, psi, 0);
    // Small pitch/roll from the local wave slope along the boat's forward/lateral axes.
    group.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.atan(slopeX) * 0.4);
    group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), Math.atan(slopeZ) * 0.4);
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
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.cameraTarget);
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
