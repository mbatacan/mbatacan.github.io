// The 3D scene: ocean swell, sky, two procedural OC6 canoes, and a chase/top-down camera.
// Browser-only (imports three and touches the DOM), loaded dynamically by the lab page so it
// never runs during Astro's static build. Waves are cosmetic (see ../../lib/ama-flow/waves.ts);
// nothing here feeds back into the physics.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { canoeOutlines, HULL_LENGTH_M } from '../../lib/ama-flow/canoe-geometry';
import { PRESETS } from '../../lib/ama-flow/presets';
import { currentVelocity, seatSide, type Conditions } from '../../lib/ama-flow/physics';
import { defaultSwell, waveHeight, waveSlope, type WaveComponent } from '../../lib/ama-flow/waves';

export type CameraMode = 'chase' | 'top';
export type BoatId = 'player' | 'opponent';

interface CrewFigure {
  group: THREE.Group;
  paddle: THREE.Group;
  torso: THREE.Mesh;
}

interface BoatVisual {
  group: THREE.Group;
  paddle: THREE.Group; // the steersman's paddle -- the only crew member the game controls
  crew: CrewFigure[]; // seats 1-5 (bow to just-forward-of-steersman), animated by setCrewStroke
  headingArrow: THREE.ArrowHelper; // scene-level, kept level regardless of hull pitch/roll
  trackerLine: THREE.Line; // scene-level dashed line to the boat's current course waypoint
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
const TURN_BUOY_HEIGHT_M = 3;
const TRACKER_LINE_HEIGHT_M = 1; // above the water, so the dashed tracker doesn't clip into swell
const HEADING_ARROW_LENGTH_M = 12;
const HEADING_ARROW_HEIGHT_M = 1.5; // above the hull, so it clears the swell and reads from above
const CHASE_BACK_DISTANCE_M = HULL_LENGTH_M * 1.0;
const CHASE_HEIGHT_M = 5;
const CHASE_LOOK_AHEAD_M = 25; // puts the finish line ahead in frame instead of the boat's beam
const TOP_DOWN_HEIGHT_M = 45;
const FOAM_COUNT = 300;
const FOAM_RADIUS_M = 60; // half-width of the drifting foam patch, recentered under the camera
const FOAM_COLOR = 0xffffff;

/** A checkered finish gate: two buoy poles and a bright line between them, so the race has a
 * visible endpoint instead of just running out over open, featureless water. Built at the local
 * origin, facing local +X (the approach direction) -- the caller positions and rotates it to the
 * course's final waypoint (see AmaFlowScene's constructor).
 */
function buildFinishLine(): THREE.Group {
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

  return group;
}

/** A single turn buoy marking an intermediate course waypoint, distinct from the two-buoy finish
 * gate so a player can tell "turn here" from "done."
 */
function buildTurnBuoy(): THREE.Group {
  const group = new THREE.Group();
  const buoy = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, TURN_BUOY_HEIGHT_M, 12),
    new THREE.MeshStandardMaterial({ color: 0xffb703, emissive: 0x442400 }),
  );
  buoy.position.y = TURN_BUOY_HEIGHT_M / 2;
  group.add(buoy);
  return group;
}

function shapeFromOutline(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

/** A basic OC6 stroke, forward/draw/poke/rudder in the physics but rendered the same way for
 * every crew seat (only the steersman's actual stroke type is known -- seats 1-5 are always
 * assumed to paddle forward). Real outrigger crews paddle around 50 strokes per minute; the
 * page drives `phase` at that rate (see rl-paddler.astro's STROKE_PERIOD_S).
 *
 * Returns `sweep` (-1 at the catch, forward in the water, to +1 at the exit, aft) and `lift`
 * (0 = blade buried, 1 = fully clear of the water during recovery), both continuous across the
 * phase 1 -> 0 wrap so consecutive strokes blend smoothly.
 */
export function forwardStrokePose(phase: number): { sweep: number; lift: number } {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.55) {
    // Drive: blade planted, sweeping from the catch (forward) to the exit (aft).
    const t = p / 0.55;
    return { sweep: -1 + 2 * t, lift: 0 };
  }
  // Recovery: blade lifts clear, swings forward, and re-enters just as phase wraps to 0.
  const t = (p - 0.55) / 0.45;
  const lift = Math.sin(t * Math.PI); // 0 at exit and catch, peak mid-recovery
  return { sweep: 1 - 2 * t, lift };
}

/** Poses a paddle (and optionally its figure's torso) from a stroke's side and its
 * forwardStrokePose()-shaped sweep/lift, shared by every crew seat and the steersman's forward
 * stroke. `side` is 0 (port) or 1 (starboard); port swings the blade to local -Z, matching the
 * ama's port rigging.
 */
function applyPaddlePose(
  paddle: THREE.Group,
  torso: THREE.Mesh | null,
  side: number,
  sweep: number,
  lift: number,
): void {
  const sideSign = side === 0 ? -1 : 1;
  paddle.position.set(sweep * 0.35, 0.65 + lift * 0.35, sideSign * (0.55 + 0.1 * lift));
  paddle.rotation.z = sideSign * 0.5;
  paddle.rotation.x = -sweep * 0.3;
  if (torso) torso.rotation.x = -sweep * 0.12; // slight forward lean at the catch
}

/** One paddler: a capsule torso, sphere head, and a small paddle, bright enough to read clearly
 * against the dark hull. Seats 1-5 are always animated as a forward stroke (see
 * forwardStrokePose) since the physics only tracks the steersman's actual stroke type.
 */
function buildCrewFigure(): CrewFigure {
  const group = new THREE.Group();
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
  const paddle = buildPaddleMesh(PADDLE_COLORS.forward);
  paddle.position.y = 0.65;
  group.add(torso, head, paddle);
  return { group, paddle, torso };
}

/** A paddle shaft plus blade, colored by stroke type. Shared by the steersman's paddle and
 * every crew figure's paddle.
 */
function buildPaddleMesh(color: number): THREE.Group {
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
    new THREE.MeshStandardMaterial({ color }),
  );
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.5, 0.22),
    new THREE.MeshStandardMaterial({ color }),
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
 * +y/port -> -Z). The ama is rigged to port, as on a real OC6.
 */
function buildCanoeMesh(hullColor: number): BoatVisual {
  const outlines = canoeOutlines();
  const group = new THREE.Group();

  function addPart(points: [number, number][], color: number, height: number, yOffset: number) {
    // rotateX(-pi/2) below maps local (x, y) -> world (x, -y), so passing (x, y) unmapped here
    // (rather than negating y first) puts sim +y (port) at world -z, i.e. to port -- matching
    // setBoatState's threeZ = -y and the steersman paddle's port/-Z convention.
    const shape = shapeFromOutline(points);
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

  const seatFigures = SEAT_X_POSITIONS.map((x) => {
    const figure = buildCrewFigure();
    figure.group.position.set(x, SEAT_HEIGHT_M, 0);
    group.add(figure.group);
    return figure;
  });

  // Seats 1-5 (bow to just forward of the steersman) always paddle forward -- the physics only
  // tracks the steersman's actual stroke type/side, so that's the only one this game can animate
  // accurately. The steersman (seat 6, stern) reuses this same figure's paddle, driven by
  // setStroke() with the real action instead of setCrewStroke()'s always-forward animation.
  const crew = seatFigures.slice(0, -1);
  const steersman = seatFigures[seatFigures.length - 1];

  const headingArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    HEADING_ARROW_LENGTH_M,
    hullColor,
    HEADING_ARROW_LENGTH_M * 0.3,
    HEADING_ARROW_LENGTH_M * 0.18,
  );

  // A dashed line to the boat's current course waypoint (see setTrackerTarget). Positions are
  // placeholders, rewritten every frame; computeLineDistances() must be called again each time
  // those positions change, or LineDashedMaterial's dash pattern stops updating.
  const trackerGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const trackerLine = new THREE.Line(
    trackerGeometry,
    new THREE.LineDashedMaterial({ color: hullColor, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.6 }),
  );
  trackerLine.computeLineDistances();

  return { group, paddle: steersman.paddle, crew, headingArrow, trackerLine };
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
  private conditions: Conditions;
  private boats: Record<BoatId, BoatVisual>;
  private lastPsi: Record<BoatId, number> = { player: 0, opponent: 0 };
  private cameraMode: CameraMode = 'chase';
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3(0, 20, -30);
  private foam: THREE.Points;
  private foamBaseXZ: Float32Array; // each fleck's fixed local (x, z) offset before drift/wrap

  constructor(canvas: HTMLCanvasElement, conditions: Conditions, waypoints: [number, number][]) {
    this.conditions = conditions;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Sky's shader outputs HDR-ish values; without tone mapping it clips straight to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.45;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
    // Blends the ocean into the horizon instead of meeting a flat, washed-out sky edge.
    this.scene.fog = new THREE.Fog(0x9fd0e8, 150, 900);

    // A low sun (~15-20 deg elevation) reads as a blue sky-with-gradient; the previous ~55 deg
    // sun lit the whole dome evenly and, combined with tone mapping, clipped toward white.
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(60, 25, -80);
    this.scene.add(sun, new THREE.AmbientLight(0x404060, 0.9));

    const sky = new Sky();
    sky.scale.setScalar(4000);
    sky.material.uniforms.turbidity.value = 2;
    sky.material.uniforms.rayleigh.value = 1.5;
    sky.material.uniforms.mieCoefficient.value = 0.004;
    sky.material.uniforms.mieDirectionalG.value = 0.8;
    sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();
    this.scene.add(sky);

    this.waves = defaultSwell(conditions.wind_direction_rad);
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
        uDeepColor: { value: new THREE.Vector3(0.05, 0.3, 0.5) },
        uShallowColor: { value: new THREE.Vector3(0.18, 0.58, 0.72) },
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
    this.scene.add(this.boats.player.headingArrow, this.boats.opponent.headingArrow);
    this.scene.add(this.boats.player.trackerLine, this.boats.opponent.trackerLine);

    // A turn buoy at every waypoint except the last, and a two-buoy finish gate at the last,
    // each oriented to face the approach from the previous waypoint (or the start, for the
    // first). Sim (x, y) -> three (x, -z), matching setBoatState's threeZ = -y convention; the
    // bearing maps the same way group.rotation.set(0, psi, 0) does for the boats themselves (see
    // setBoatState), so no separate sign flip is needed for the rotation.
    waypoints.forEach(([wx, wy], i) => {
      const [px, py] = i === 0 ? [0, 0] : waypoints[i - 1];
      const bearingRad = Math.atan2(wy - py, wx - px);
      const marker = i === waypoints.length - 1 ? buildFinishLine() : buildTurnBuoy();
      marker.position.set(wx, 0, -wy);
      marker.rotation.y = bearingRad;
      this.scene.add(marker);
    });

    // A patch of surface flecks that drift with the current, recentered under the camera each
    // frame (like the ocean mesh) so the current -- otherwise invisible against open water -- is
    // visible as sideways drift. See render() for the per-frame position update.
    this.foamBaseXZ = new Float32Array(FOAM_COUNT * 2);
    for (let i = 0; i < FOAM_COUNT; i++) {
      this.foamBaseXZ[i * 2] = (Math.random() * 2 - 1) * FOAM_RADIUS_M;
      this.foamBaseXZ[i * 2 + 1] = (Math.random() * 2 - 1) * FOAM_RADIUS_M;
    }
    const foamGeometry = new THREE.BufferGeometry();
    foamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FOAM_COUNT * 3), 3));
    this.foam = new THREE.Points(
      foamGeometry,
      new THREE.PointsMaterial({ color: FOAM_COLOR, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.8 }),
    );
    this.scene.add(this.foam);

    this.resize();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  /** Place a boat at world (x, y) [ama-flow's sim frame] and heading psi (rad), resting on the
   * cosmetic swell at elapsedSeconds. Also updates that boat's heading arrow, since the water
   * makes the hull's own orientation hard to read at a glance.
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

    const arrow = this.boats[which].headingArrow;
    arrow.position.set(threeX, height + HEADING_ARROW_HEIGHT_M, threeZ);
    arrow.setDirection(new THREE.Vector3(Math.cos(psi), 0, -Math.sin(psi))); // sim +y/port -> world -z
    this.lastPsi[which] = psi;
  }

  /** Point that boat's dashed tracker line at its current course waypoint, given in ama-flow's
   * sim frame -- called once per frame after setBoatState, since the line runs from the boat's
   * current (rendered) position to the target.
   */
  setTrackerTarget(which: BoatId, waypointX: number, waypointY: number): void {
    const boatPosition = this.boats[which].group.position;
    const line = this.boats[which].trackerLine;
    const positions = line.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, boatPosition.x, boatPosition.y + TRACKER_LINE_HEIGHT_M, boatPosition.z);
    positions.setXYZ(1, waypointX, boatPosition.y + TRACKER_LINE_HEIGHT_M, -waypointY);
    positions.needsUpdate = true;
    line.computeLineDistances(); // required every time positions change, or dashes freeze
  }

  /** Update wind/current for a new race (conditions are randomized per race -- see game.ts's
   * randomConditions). Only the swell direction depends on wind direction; amplitude, wavenumber
   * and speed don't, so only the three direction uniforms need updating.
   */
  setConditions(conditions: Conditions): void {
    this.conditions = conditions;
    this.waves = defaultSwell(conditions.wind_direction_rad);
    this.oceanMaterial.uniforms.uDirection0.value.set(...this.waves[0].direction);
    this.oceanMaterial.uniforms.uDirection1.value.set(...this.waves[1].direction);
    this.oceanMaterial.uniforms.uDirection2.value.set(...this.waves[2].direction);
  }

  /** The sim-frame heading (ama-flow's CCW-from-+x convention) that currently points "up" on
   * screen, for the HUD wind/current compass: the focused boat's own heading in chase view, or a
   * fixed angle in top-down view (that camera looks straight down with screen-up = world -z,
   * which is sim +y -- see setBoatState's threeZ = -y).
   */
  viewUpAngleRad(focus: BoatId): number {
    return this.cameraMode === 'top' ? Math.PI / 2 : this.lastPsi[focus];
  }

  /** Animate the always-forward-paddling crew (seats 1-5) in sync: alternating sides per
   * ama-flow's seatSide/hut logic, sweeping through the drive and lifting clear on recovery.
   * The steersman (seat 6) is animated separately by setStroke(), since only their stroke is an
   * actual action in the physics.
   */
  setCrewStroke(which: BoatId, strokeIndex: number, phase: number): void {
    const { sweep, lift } = forwardStrokePose(phase);
    this.boats[which].crew.forEach((figure, seat) => {
      const side = seatSide(PRESETS.crew, seat, strokeIndex);
      applyPaddlePose(figure.paddle, figure.torso, side, sweep, lift);
    });
  }

  /** Animate the steersman's paddle for the current stroke: which side (0 = port, 1 =
   * starboard), which of the four stroke types, and phase in [0, 1) for progress through it.
   * This is the one crew member whose actual action the game controls, so it's the one animated
   * with the real stroke type rather than always-forward.
   */
  setStroke(which: BoatId, side: number, strokeType: number, phase: number): void {
    const paddle = this.boats[which].paddle;
    const key = STROKE_TYPE_KEYS[strokeType] ?? 'forward';
    if (key === 'forward') {
      const { sweep, lift } = forwardStrokePose(phase);
      applyPaddlePose(paddle, null, side, sweep, lift);
    } else {
      // Draw/poke/rudder don't have a drive/recovery cycle in the physics -- just show the
      // blade planted on the working side with a small flourish through the stroke.
      const sideSign = side === 0 ? -1 : 1; // port -> local -Z, starboard -> local +Z
      const swing = Math.sin(Math.min(phase, 1) * Math.PI); // 0 at start/end, peak mid-stroke
      paddle.position.set(0, 0.65, sideSign * (0.55 + 0.15 * swing));
      paddle.rotation.z = sideSign * 0.5;
      paddle.rotation.x = -0.3 + 0.5 * swing;
    }

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

    // The heading arrow only reads well from directly above -- in chase view the camera already
    // looks down the boat's own heading, so the arrow points almost straight at/away from it and
    // renders as a flat, illegible blob. It's only useful (and only shown) in top-down.
    const showHeadingArrows = this.cameraMode === 'top';
    this.boats.player.headingArrow.visible = showHeadingArrows;
    this.boats.opponent.headingArrow.visible = showHeadingArrows;

    if (this.cameraMode === 'top') {
      const desiredPos = new THREE.Vector3(focused.x, TOP_DOWN_HEIGHT_M, focused.z + 0.001);
      const desiredTarget = focused.clone();
      this.cameraPosition.lerp(desiredPos, 0.08);
      this.cameraTarget.lerp(desiredTarget, 0.08);
    } else {
      // Body-frame +x is forward (see buildCanoeMesh), so the chase cam sits behind the boat
      // along -x and looks toward a point ahead of it, putting the finish line in view instead
      // of the boat's beam.
      const forward = new THREE.Vector3(1, 0, 0)
        .applyEuler(this.boats[focus].group.rotation)
        .normalize();
      const desiredPos = focused
        .clone()
        .sub(forward.clone().multiplyScalar(CHASE_BACK_DISTANCE_M))
        .add(new THREE.Vector3(0, CHASE_HEIGHT_M, 0));
      const desiredTarget = focused
        .clone()
        .add(forward.clone().multiplyScalar(CHASE_LOOK_AHEAD_M))
        .add(new THREE.Vector3(0, 2, 0));
      this.cameraPosition.lerp(desiredPos, 0.08);
      this.cameraTarget.lerp(desiredTarget, 0.08);
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

    // Drift the foam patch by the current's displacement since t=0 (velocity is constant, so
    // this is just velocity * time, no need to track a per-frame delta), wrap each fleck back
    // into the patch once it drifts past FOAM_RADIUS_M, and recenter the whole patch under the
    // camera -- the same "infinite ocean" trick setBoatState/the ocean mesh use.
    const [currentVx, currentVy] = currentVelocity(this.conditions);
    const driftX = currentVx * elapsedSeconds;
    const driftZ = -currentVy * elapsedSeconds; // sim +y -> world -z
    const twoR = FOAM_RADIUS_M * 2;
    const wrap = (v: number) => (((v % twoR) + twoR + FOAM_RADIUS_M) % twoR) - FOAM_RADIUS_M;
    const positions = this.foam.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < FOAM_COUNT; i++) {
      const localX = wrap(this.foamBaseXZ[i * 2] - driftX);
      const localZ = wrap(this.foamBaseXZ[i * 2 + 1] - driftZ);
      const x = localX + this.cameraPosition.x;
      const z = localZ + this.cameraPosition.z;
      positions.setXYZ(i, x, waveHeight(this.waves, x, z, elapsedSeconds) + 0.05, z);
    }
    positions.needsUpdate = true;

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
