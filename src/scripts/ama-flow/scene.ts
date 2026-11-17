// The 3D scene: ocean swell, sky, islands, two procedural OC6 canoes, and a chase/top-down camera.
// Browser-only (imports three and touches the DOM), loaded dynamically by the lab page so it
// never runs during Astro's static build. Waves are cosmetic (see ../../lib/ama-flow/waves.ts);
// nothing here feeds back into the physics.
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import {
  AMA_BEAM_M,
  AMA_LENGTH_M,
  AMA_OFFSET_M,
  HULL_BEAM_M,
  HULL_LENGTH_M,
  IAKO_SPACING_FRACTION,
} from '../../lib/ama-flow/canoe-geometry';
import { FINISH_GATE_HALF_WIDTH_M } from './game';
import { Wake } from './wake';
import { PRESETS } from '../../lib/ama-flow/presets';
import { currentVelocity, seatSide, type Conditions } from '../../lib/ama-flow/physics';
import { defaultSwell, waveHeight, waveSlope, type WaveComponent } from '../../lib/ama-flow/waves';

export type CameraMode = 'chase' | 'top';
export type BoatId = 'player' | 'opponent';

interface CrewFigure {
  group: THREE.Group;
  paddle: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
}

interface BoatVisual {
  group: THREE.Group;
  steersman: CrewFigure; // the only crew member the game controls (seat 6, stern)
  crew: CrewFigure[]; // seats 1-5 (bow to just-forward-of-steersman), animated by setCrewStroke
  headingArrow: THREE.ArrowHelper; // scene-level, kept level regardless of hull pitch/roll
  tracker: TrackerLine; // scene-level dashed line to the boat's current course waypoint
}

// Body-frame x of each seat, stern (steersman, seat 6) to bow (seat 1) -- mirrors the "steersman
// sits about 5m aft of CG" note in ama-flow's oc6_stroke_config().
const SEAT_X_POSITIONS = [5, 3, 1, -1, -3, -5];
const CREW_SHIRT_COLOR = 0xff8c00;
const CREW_SKIN_COLOR = 0xc98f62;
const CREW_HAIR_COLOR = 0x161b2c;
const SEAT_HEIGHT_M = 0.85;

const STROKE_TYPE_KEYS = ['forward', 'draw', 'poke', 'rudder'] as const;
const PADDLE_SHAFT_COLOR = 0x20242f;
// The blade's color, by the steersman's stroke type; the crew always paddles forward.
const PADDLE_COLORS: Record<(typeof STROKE_TYPE_KEYS)[number], number> = {
  forward: 0xefe7d2,
  draw: 0x3aa0c8,
  poke: 0xe07a2e,
  rudder: 0xd43c3c,
};

const OCEAN_SIZE_M = 800;
const OCEAN_SEGMENTS = 256;
const HULL_COLORS: Record<BoatId, number> = { player: 0x8f8fff, opponent: 0xff7b6e };
const AMA_COLOR = 0xe6e6ff;
const IAKO_COLOR = 0x161b2c;
const HULL_TOP_M = 0.5; // gunwale height above the waterline
const HULL_DEPTH_M = 0.7;
const AMA_TOP_M = 0.3;
const AMA_DEPTH_M = 0.35;
// Colors the ocean and sky shaders share, written as the sRGB values that reach the screen
// (ShaderMaterial output is not tone mapped or color converted).
const SUN_DIRECTION = new THREE.Vector3(60, 25, -80).normalize();
const HAZE_COLOR = 0xc2cfc6; // where the sea meets the sky
const ISLAND_COLORS = [0x7d96a3, 0x5f7c8b]; // far ridge, near ridge
const ISLAND_DISTANCE_M = 3000;
// Both boats run identical physics from (0, 0), so without this they'd render exactly on top of
// each other. This offset is visual only -- applied to the mesh, never to the simulated state.
const BOAT_LANE_OFFSET_M: Record<BoatId, number> = { player: 5, opponent: -5 };
// Matches game.ts's FINISH_GATE_HALF_WIDTH_M, the actual rounding tolerance -- so the visible
// gate is exactly as wide as what the physics enforces, not just a decoration.
const FINISH_LINE_HALF_WIDTH_M = FINISH_GATE_HALF_WIDTH_M;
const TRACKER_LINE_HEIGHT_M = 1; // above mean sea level, so the dashed tracker clears the swell
const TRACKER_START_AHEAD_M = 9; // starts just past the bow (6.7 m), clear of the hull and the camera's foreground
const TRACKER_DASH_M = 3;
const TRACKER_GAP_M = 2;
const MAX_TRACKER_DASHES = 120; // 120 * 5 m = 600 m, well past any leg of the course
const TRACKER_WIDTH_PX = 4;
const TRACKER_OUTLINE_WIDTH_PX = 8;
const TRACKER_OUTLINE_COLOR = 0x0b1030; // dark, so the line reads against both light and dark water
// Lighter than the hull colors: the line sits on teal water, where the hull blue/red are dim.
const TRACKER_COLORS: Record<BoatId, number> = { player: 0xb8b8ff, opponent: 0xff8a8a };
const HEADING_ARROW_LENGTH_M = 12;
const HEADING_ARROW_HEIGHT_M = 1.5; // above the hull, so it clears the swell and reads from above
const CHASE_BACK_DISTANCE_M = HULL_LENGTH_M * 1.0;
const CHASE_HEIGHT_M = 5;
const CHASE_LOOK_AHEAD_M = 25; // puts the finish line ahead in frame instead of the boat's beam
const TOP_DOWN_HEIGHT_M = 45;
const FOAM_COUNT = 500;
const FOAM_RADIUS_M = 60; // half-width of the foam patch around the camera
const FOAM_COLOR = 0xffffff;

/** A floating marker: a rounded cone with a pole and a pennant, so it reads as a buoy from the
 * chase camera at a few hundred metres.
 */
function buildBuoy(color: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 16), material);
  body.position.y = 0.6;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 3, 6),
    new THREE.MeshStandardMaterial({ color: PADDLE_SHAFT_COLOR }),
  );
  pole.position.y = 2.6;
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(1.4, -0.4);
  flagShape.lineTo(0, -0.8);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), material);
  flag.position.y = 4.1;
  group.add(body, pole, flag);
  return group;
}

/** The finish gate: two flagged buoys and a bright line between them, so the race has a visible
 * endpoint instead of just running out over open water. Built at the local origin, facing local
 * +X (the approach direction) -- the caller positions and rotates it to the course's final
 * waypoint (see AmaFlowScene's constructor).
 */
function buildFinishLine(): THREE.Group {
  const group = new THREE.Group();
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.05, FINISH_LINE_HALF_WIDTH_M * 2),
    new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0x554400 }),
  );
  line.position.y = 0.05;
  group.add(line);
  for (const z of [FINISH_LINE_HALF_WIDTH_M, -FINISH_LINE_HALF_WIDTH_M]) {
    const buoy = buildBuoy(0xff5a4d);
    buoy.position.z = z;
    group.add(buoy);
  }
  return group;
}

/** A hull or float as a smooth, double-ended shell: U-shaped cross-sections that narrow to a
 * point at each end, with the ends swept up a little. Centred on the origin, +x forward, the
 * gunwale at y = topM.
 */
function buildShell(lengthM: number, beamM: number, topM: number, depthM: number, color: number): THREE.Mesh {
  const stations = 24;
  const ring = 9; // points around each cross-section, gunwale to keel to gunwale
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const s = (i / stations) * 2 - 1; // -1 stern .. +1 bow
    const taper = Math.sqrt(1 - s * s); // 1 amidships, 0 at the ends
    const sheer = topM + 0.25 * Math.abs(s) ** 3;
    for (let j = 0; j < ring; j++) {
      const angle = (j / (ring - 1)) * Math.PI;
      positions.push(
        (s * lengthM) / 2,
        sheer - depthM * taper * Math.sin(angle) ** 0.7,
        (beamM / 2) * taper * Math.cos(angle),
      );
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring); // wrapping closes the section across the deck
      indices.push(a, a + ring, b, b, a + ring, b + ring);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.45 }));
}

/** Share of a forward-stroke cycle spent pulling (the drive); the rest is recovery. Real paddle
 * strokes spend well under half the cycle pulling -- most of it is the blade swinging back out
 * front, which is what makes the reach read as a reach.
 */
const DRIVE_FRACTION = 0.4;

/** A basic OC6 stroke, forward/draw/poke/rudder in the physics but rendered the same way for
 * every crew seat (only the steersman's actual stroke type is known -- seats 1-5 are always
 * assumed to paddle forward). Real outrigger crews paddle around 50 strokes per minute; the
 * page drives `phase` at that rate (see STROKE_PERIOD_S in page.ts).
 *
 * Returns `sweep` (-1 at the catch, forward in the water, to +1 at the exit, aft) and `lift`
 * (0 = blade buried, 1 = fully clear of the water during recovery). Both are continuous across
 * the phase 1 -> 0 wrap, and sweep eases in and out of each extreme so the blade doesn't snap
 * between the drive and the recovery.
 */
export function forwardStrokePose(phase: number): { sweep: number; lift: number } {
  const p = ((phase % 1) + 1) % 1;
  if (p < DRIVE_FRACTION) {
    // Drive: blade planted, pulled from the catch (forward) to the exit (aft).
    const t = p / DRIVE_FRACTION;
    return { sweep: -Math.cos(Math.PI * t), lift: 0 };
  }
  // Recovery: blade lifts clear and swings forward, re-entering at the catch as phase wraps to 0.
  const t = (p - DRIVE_FRACTION) / (1 - DRIVE_FRACTION);
  return { sweep: Math.cos(Math.PI * t), lift: Math.sin(Math.PI * t) };
}

// Paddler geometry, in a figure's own frame: origin at the hip/seat, +x forward, +y up, -z port.
const SHAFT_HALF_LENGTH_M = 0.7; // buildPaddleMesh's shaft is 1.4 m, centered on the paddle group
export const BLADE_CENTER_OFFSET_M = -0.9; // blade center below the paddle group's origin
const TOP_HAND_TO_BLADE_M = SHAFT_HALF_LENGTH_M - BLADE_CENTER_OFFSET_M;
const TORSO_CENTER_M = 0.35; // torso capsule center above the hip
const HEAD_CENTER_M = 0.75;
const BLADE_PLANTED_Y_M = -0.75; // blade center height while pulling: half under the surface
const BLADE_RECOVERY_LIFT_M = 0.45; // how far the blade rises at mid-recovery
const SHAFT_SWING_RAD = 0.42; // shaft angle from vertical at the catch (forward) and exit (aft)
const SHAFT_CANT_RAD = 0.19; // the blade sits outboard of the top hand, as on a real paddle
const TORSO_PITCH_CATCH_RAD = 0.4; // leaning forward into the reach
const TORSO_PITCH_EXIT_RAD = -0.1; // finishing slightly upright/back
const TOP_HAND_AHEAD_OF_HEAD_M = 0.15;
const TOP_HAND_LATERAL_M = 0.25; // top hand's distance from the centerline

export interface PaddlePose {
  /** Where to put the paddle group, in the figure frame. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /** Forward lean of the torso about the hip, in radians (positive = toward +x). */
  torsoPitch: number;
}

/** The paddle and body pose for one moment of a forward stroke, from forwardStrokePose()'s
 * sweep (-1 catch .. +1 exit) and lift. `side` is 0 (port) or 1 (starboard); port is local -Z,
 * matching the ama's port rigging.
 *
 * The paddle swings about the top hand, not the middle of the shaft, so the shaft angle sweeps
 * the blade through an arc. The top hand rides with the leaning torso (forward at the catch),
 * and its height is set so the blade stays at a constant depth through the drive and rises
 * clear of the water only during recovery.
 */
export function paddlePose(side: number, sweep: number, lift: number): PaddlePose {
  const sideSign = side === 0 ? -1 : 1;
  const torsoPitch =
    (TORSO_PITCH_CATCH_RAD + TORSO_PITCH_EXIT_RAD) / 2 -
    ((TORSO_PITCH_CATCH_RAD - TORSO_PITCH_EXIT_RAD) / 2) * sweep;
  // Positive shaft pitch puts the blade ahead of the hand (rotation about local Z tips the
  // shaft's bottom toward +x); the cant about X tips the blade outward to the paddling side.
  const shaftPitch = -SHAFT_SWING_RAD * sweep;
  const rotation = new THREE.Euler(-sideSign * SHAFT_CANT_RAD, 0, shaftPitch);

  const bladeY = BLADE_PLANTED_Y_M + BLADE_RECOVERY_LIFT_M * lift;
  const hand = new THREE.Vector3(
    HEAD_CENTER_M * Math.sin(torsoPitch) + TOP_HAND_AHEAD_OF_HEAD_M,
    bladeY + TOP_HAND_TO_BLADE_M * Math.cos(shaftPitch) * Math.cos(SHAFT_CANT_RAD),
    sideSign * TOP_HAND_LATERAL_M,
  );
  // The group's origin is the middle of the shaft, so back off from the hand by the rotated
  // half-shaft to put the shaft's top end exactly on the hand.
  const topOffset = new THREE.Vector3(0, SHAFT_HALF_LENGTH_M, 0).applyEuler(rotation);
  return { position: hand.sub(topOffset), rotation, torsoPitch };
}

/** Leans a figure's torso and head forward by `pitch` radians about the hip (the figure's origin). */
function poseTorso({ torso, head }: CrewFigure, pitch: number): void {
  torso.rotation.z = -pitch; // rotation about +Z tips +Y toward -X, so a forward lean is negative
  torso.position.set(TORSO_CENTER_M * Math.sin(pitch), TORSO_CENTER_M * Math.cos(pitch), 0);
  head.position.set(HEAD_CENTER_M * Math.sin(pitch), HEAD_CENTER_M * Math.cos(pitch), 0);
}

/** Poses a figure's paddle and body for a forward stroke at the given sweep/lift. */
function applyForwardStroke(figure: CrewFigure, side: number, sweep: number, lift: number): void {
  const { position, rotation, torsoPitch } = paddlePose(side, sweep, lift);
  figure.paddle.position.copy(position);
  figure.paddle.rotation.copy(rotation);
  poseTorso(figure, torsoPitch);
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
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: CREW_HAIR_COLOR }),
  );
  head.add(hair);
  const paddle = buildPaddleMesh(PADDLE_COLORS.forward);
  paddle.position.y = 0.65;
  group.add(torso, head, paddle);
  return { group, paddle, torso, head };
}

/** A dark paddle shaft plus a blade colored by stroke type. Shared by the steersman's paddle
 * and every crew figure's paddle.
 */
function buildPaddleMesh(color: number): THREE.Group {
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: PADDLE_SHAFT_COLOR }),
  );
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.5, 0.22),
    new THREE.MeshStandardMaterial({ color }),
  );
  blade.position.y = -0.9;
  paddle.add(shaft, blade);
  paddle.userData.blade = blade;
  return paddle;
}

/** The [from, to] distances along a line of `length` metres (measured from its start) for each
 * dash, laid out from the END of the line backwards: the first dash finishes exactly at `length`.
 * Anchoring the pattern to the far end (the waypoint) rather than the near end (the boat) keeps
 * the dashes fixed in the world as the boat moves, so they scroll past smoothly instead of
 * streaming along the line and flickering. The dash that would run past the start is cut short,
 * and at most `maxDashes` are returned.
 */
export function dashSpans(
  length: number,
  dashM: number,
  gapM: number,
  maxDashes: number,
): [number, number][] {
  const spans: [number, number][] = [];
  for (let end = length; end > 0 && spans.length < maxDashes; end -= dashM + gapM) {
    spans.push([Math.max(0, end - dashM), end]);
  }
  return spans;
}

/** A dashed line from a boat to its current waypoint, thick enough to read from the chase camera.
 * WebGL lines are always one pixel wide, so this uses three's screen-space LineSegments2 with each
 * dash as its own segment, rewritten in place every frame (no allocation). A wider, dark copy under
 * the colored one outlines it, so it stands out on any water color.
 */
class TrackerLine {
  readonly objects: LineSegments2[];
  private readonly positions = new Float32Array(MAX_TRACKER_DASHES * 6);
  private readonly geometry = new LineSegmentsGeometry();
  private readonly materials: LineMaterial[];
  private readonly direction = new THREE.Vector3();

  constructor(color: number) {
    this.geometry.setPositions(this.positions); // uses the array as-is, so set() can write into it
    this.materials = [
      new LineMaterial({ color: TRACKER_OUTLINE_COLOR, linewidth: TRACKER_OUTLINE_WIDTH_PX, toneMapped: false }),
      new LineMaterial({ color, linewidth: TRACKER_WIDTH_PX, toneMapped: false }),
    ];
    this.objects = this.materials.map((material, i) => {
      const line = new LineSegments2(this.geometry, material);
      line.frustumCulled = false; // the bounds were computed from the empty initial positions
      line.renderOrder = i + 1; // outline first, colored line on top
      return line;
    });
  }

  /** Lay the dashes along the line from `start` to `end`. */
  set(start: THREE.Vector3, end: THREE.Vector3): void {
    const length = start.distanceTo(end);
    this.direction.subVectors(end, start).normalize();
    const spans = dashSpans(length, TRACKER_DASH_M, TRACKER_GAP_M, MAX_TRACKER_DASHES);
    spans.forEach(([from, to], i) => {
      const o = i * 6;
      this.positions[o] = start.x + this.direction.x * from;
      this.positions[o + 1] = start.y + this.direction.y * from;
      this.positions[o + 2] = start.z + this.direction.z * from;
      this.positions[o + 3] = start.x + this.direction.x * to;
      this.positions[o + 4] = start.y + this.direction.y * to;
      this.positions[o + 5] = start.z + this.direction.z * to;
    });
    (this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    this.geometry.instanceCount = spans.length;
  }

  /** Line widths are in pixels, so the materials need the canvas size. */
  setResolution(width: number, height: number): void {
    this.materials.forEach((material) => material.resolution.set(width, height));
  }
}

/** An OC6: hull, ama, two iako, six paddlers, and the steersman's paddle, resting on the water
 * plane. Body-frame +x is forward and Y is up, so a Y-axis rotation by heading psi orients it as
 * ama_flow's own top-down glyph would (sim +y/port -> -Z). The ama is rigged to port, as on a
 * real OC6.
 */
function buildCanoeMesh(hullColor: number, trackerColor: number): BoatVisual {
  const group = new THREE.Group();

  group.add(buildShell(HULL_LENGTH_M, HULL_BEAM_M, HULL_TOP_M, HULL_DEPTH_M, hullColor));
  const ama = buildShell(AMA_LENGTH_M, AMA_BEAM_M, AMA_TOP_M, AMA_DEPTH_M, AMA_COLOR);
  ama.position.z = -AMA_OFFSET_M;
  group.add(ama);
  // Each iako arches from the hull's gunwale over to the top of the ama.
  const iakoMaterial = new THREE.MeshStandardMaterial({ color: IAKO_COLOR });
  for (const x of [AMA_LENGTH_M * IAKO_SPACING_FRACTION, -AMA_LENGTH_M * IAKO_SPACING_FRACTION]) {
    const arch = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(x, HULL_TOP_M, 0),
      new THREE.Vector3(x, HULL_TOP_M + 0.45, -AMA_OFFSET_M * 0.6),
      new THREE.Vector3(x, AMA_TOP_M, -AMA_OFFSET_M),
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(arch, 12, 0.05, 6), iakoMaterial));
  }

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

  // A dashed line to the boat's current course waypoint, rewritten every frame (see setTrackerTarget).
  const tracker = new TrackerLine(trackerColor);

  return { group, steersman, crew, headingArrow, tracker };
}

// Shared by the sky dome and the ocean (which reflects it): the sky color in a given direction.
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSunDirection;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = p * 2.03 + 17.0;
      amp *= 0.5;
    }
    return sum;
  }

  vec3 skyColor(vec3 dir) {
    // Blue overhead, through pale blue to a warm cream band at the horizon.
    float low = 1.0 - clamp(dir.y / 0.45, 0.0, 1.0);
    vec3 color = mix(vec3(0.247, 0.392, 0.533), vec3(0.561, 0.690, 0.769), smoothstep(0.0, 0.55, low));
    color = mix(color, vec3(0.851, 0.839, 0.769), smoothstep(0.55, 0.86, low));
    color = mix(color, vec3(0.937, 0.886, 0.776), smoothstep(0.86, 1.0, low));
    float toSun = max(dot(dir, uSunDirection), 0.0);
    color += vec3(1.0, 0.93, 0.77) * (0.3 * pow(toSun, 6.0) + 0.9 * pow(toSun, 400.0));
    return color;
  }

  // Long, soft cloud streaks, thinning out toward the horizon.
  float cloudCover(vec3 dir) {
    vec2 p = dir.xz / (dir.y + 0.12);
    float streaks = fbm(p * vec2(0.9, 2.6) + 4.0);
    return smoothstep(0.5, 0.78, streaks) * smoothstep(0.02, 0.14, dir.y) * 0.55;
  }
`;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  ${SKY_GLSL}
  uniform vec3 uHazeColor;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    vec3 color = mix(skyColor(dir), vec3(1.0), cloudCover(dir));
    // Below the horizon is only seen past the edge of the ocean mesh, which fades to the same haze.
    gl_FragColor = vec4(mix(uHazeColor, color, smoothstep(-0.004, 0.004, dir.y)), 1.0);
  }
`;

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
  varying vec3 vWorldPosition;

  float phaseOf(vec2 dir, float k, float w, vec2 pos) {
    return k * dot(dir, pos) - w * uTime;
  }

  void main() {
    // The plane is built flat in local XY, then the mesh is rotated -90 deg about X so local
    // (x, y) -> world (x, z) = (x, -y). The mesh is also recentered under the camera every
    // frame (an "infinite ocean" -- see AmaFlowScene.render) since it's a finite plane and a
    // race can cover more ground than that; uWorldOffset is the mesh's current world
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
    vWorldPosition = vec3(pos.x, h, pos.y);
    vec3 displaced = vec3(position.x, position.y, h);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

// Teal water lit the way open ocean is: mostly a reflection of the sky at grazing angles, the
// water's own color where you look down into it, a sun glitter path, and foam on the highest
// crests. Wind ripples are a noise-perturbed normal, drifting downwind.
const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  ${SKY_GLSL}
  uniform float uTime;
  uniform vec2 uWindDirection;
  uniform vec3 uHazeColor;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  float ripples(vec2 p) {
    return fbm(p * 0.9 - uWindDirection * uTime * 0.7) + 0.5 * fbm(p * 2.7 - uWindDirection * uTime * 1.3);
  }

  void main() {
    vec3 toCamera = cameraPosition - vWorldPosition;
    float distance = length(toCamera);
    vec3 view = toCamera / distance;

    vec2 p = vWorldPosition.xz;
    float e = 0.15;
    float r0 = ripples(p);
    vec2 slope = vec2(ripples(p + vec2(e, 0.0)) - r0, ripples(p + vec2(0.0, e)) - r0) / e;
    // Ripples fade with distance: past a few hundred metres they are smaller than a pixel and
    // would only shimmer.
    float detail = 0.22 / (1.0 + distance * 0.02);
    // The swell's own normal flattens out far away too, where the mesh is too coarse to carry it
    // and it would band into moire near the horizon.
    vec3 swellNormal = mix(vNormal, vec3(0.0, 1.0, 0.0), smoothstep(60.0, 260.0, distance));
    vec3 normal = normalize(swellNormal + vec3(-slope.x, 0.0, -slope.y) * detail);

    float crest = clamp(vHeight * 1.2 + 0.5, 0.0, 1.0);
    vec3 water = mix(vec3(0.031, 0.188, 0.247), vec3(0.122, 0.420, 0.478), crest);
    // Sunlight through the thin top of a wave facing the camera.
    float backlit = pow(max(dot(view.xz, -normalize(uSunDirection.xz)), 0.0), 2.0);
    water += vec3(0.10, 0.36, 0.33) * backlit * smoothstep(0.55, 1.0, crest);

    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
    vec3 reflected = reflect(-view, normal);
    reflected.y = abs(reflected.y);
    vec3 color = mix(water, skyColor(reflected), fresnel);
    color += vec3(1.0, 0.95, 0.82) * pow(max(dot(reflected, uSunDirection), 0.0), 220.0) * 1.6;

    float foam = smoothstep(0.38, 0.55, vHeight) * smoothstep(0.72, 1.0, r0) * 0.85;
    color = mix(color, vec3(0.96, 0.98, 0.98), foam);

    color = mix(color, uHazeColor, smoothstep(160.0, 390.0, distance));
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A ridge line as a flat silhouette, `widthM` wide, from heights given as fractions of `heightM`. */
function buildIsland(profile: number[], widthM: number, heightM: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-widthM / 2, 0);
  profile.forEach((h, i) => shape.lineTo((i / (profile.length - 1) - 0.5) * widthM, h * heightM));
  shape.lineTo(widthM / 2, 0);
  return new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false }),
  );
}

export class AmaFlowScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private backdrop = new THREE.Group(); // sky dome and islands, kept centred on the camera
  private ocean: THREE.Mesh;
  private oceanMaterial: THREE.ShaderMaterial;
  private waves: WaveComponent[];
  private conditions: Conditions;
  private boats: Record<BoatId, BoatVisual>;
  private wakes: Record<BoatId, Wake> = { player: new Wake(), opponent: new Wake() };
  private trackerStart = new THREE.Vector3(); // scratch vectors for setTrackerTarget
  private trackerEnd = new THREE.Vector3();
  private cameraMode: CameraMode = 'chase';
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3(0, 20, -30);
  private foam: THREE.Points;
  private foamBaseXZ: Float32Array; // each fleck's fixed starting (x, z), before drift and wrap

  constructor(canvas: HTMLCanvasElement, conditions: Conditions, waypoints: [number, number][]) {
    this.conditions = conditions;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
    // Hazes distant boats and buoys toward the same color the ocean fades to.
    this.scene.fog = new THREE.Fog(HAZE_COLOR, 200, 900);

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.copy(SUN_DIRECTION);
    this.scene.add(sun, new THREE.HemisphereLight(0xcfe0ee, 0x1f6b7a, 1.6));

    const hazeColor = new THREE.Color(HAZE_COLOR).convertLinearToSRGB(); // the hex is the on-screen color
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(8000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        uniforms: { uSunDirection: { value: SUN_DIRECTION }, uHazeColor: { value: hazeColor } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    // Two overlapping ridges off the starboard bow of the first leg, far enough to sit on the horizon.
    const farRidge = buildIsland([0, 0.1, 0.45, 0.55, 0.85, 1, 0.9, 0.95, 0.8, 0.6, 0.3, 0], 2600, 260, ISLAND_COLORS[0]);
    const nearRidge = buildIsland([0, 0.3, 0.75, 0.9, 1, 0.8, 0.5, 0.15, 0], 1500, 150, ISLAND_COLORS[1]);
    farRidge.position.set(ISLAND_DISTANCE_M * 0.8, 0, ISLAND_DISTANCE_M * 0.6);
    nearRidge.position.set(ISLAND_DISTANCE_M * 0.62, 0, ISLAND_DISTANCE_M * 0.72);
    farRidge.lookAt(0, 0, 0);
    nearRidge.lookAt(0, 0, 0);
    this.backdrop.add(sky, farRidge, nearRidge);
    this.scene.add(this.backdrop);

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
        uWindDirection: { value: new THREE.Vector2(...this.waves[0].direction) },
        uSunDirection: { value: SUN_DIRECTION },
        uHazeColor: { value: hazeColor },
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
      player: buildCanoeMesh(HULL_COLORS.player, TRACKER_COLORS.player),
      opponent: buildCanoeMesh(HULL_COLORS.opponent, TRACKER_COLORS.opponent),
    };
    this.scene.add(this.boats.player.group, this.boats.opponent.group);
    this.scene.add(this.wakes.player.mesh, this.wakes.opponent.mesh);
    this.scene.add(this.boats.player.headingArrow, this.boats.opponent.headingArrow);
    this.scene.add(...this.boats.player.tracker.objects, ...this.boats.opponent.tracker.objects);

    // A turn buoy at every waypoint except the last, and a two-buoy finish gate at the last,
    // each oriented to face the approach from the previous waypoint (or the start, for the
    // first). Sim (x, y) -> three (x, -z), matching setBoatState's threeZ = -y convention; the
    // bearing maps the same way group.rotation.set(0, psi, 0) does for the boats themselves (see
    // setBoatState), so no separate sign flip is needed for the rotation.
    waypoints.forEach(([wx, wy], i) => {
      const [px, py] = i === 0 ? [0, 0] : waypoints[i - 1];
      const bearingRad = Math.atan2(wy - py, wx - px);
      const marker = i === waypoints.length - 1 ? buildFinishLine() : buildBuoy(0xffc533);
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
      new THREE.PointsMaterial({ color: FOAM_COLOR, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.8 }),
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

    const [currentVx, currentVy] = currentVelocity(this.conditions);
    this.wakes[which].update(threeX, threeZ, psi, elapsedSeconds, [currentVx, -currentVy], this.waves); // sim +y -> world -z
  }

  /** Point that boat's dashed tracker line at its current course waypoint, given in ama-flow's
   * sim frame -- called once per frame after setBoatState, since the line runs from the boat's
   * current (rendered) position to the target.
   */
  setTrackerTarget(which: BoatId, waypointX: number, waypointY: number): void {
    const boatPosition = this.boats[which].group.position;
    // A fixed height above mean sea level, not the boat's own (swell-heaved) height, or the whole
    // line bobs up and down with every wave.
    this.trackerStart.set(boatPosition.x, TRACKER_LINE_HEIGHT_M, boatPosition.z);
    this.trackerEnd.set(waypointX, TRACKER_LINE_HEIGHT_M, -waypointY);
    // Start the line ahead of the bow: seen from the chase camera the stretch right at the boat is
    // end-on and foreshortened, so its dashes pile into a flickering smear.
    const gap = this.trackerStart.distanceTo(this.trackerEnd);
    if (gap > TRACKER_START_AHEAD_M) this.trackerStart.lerp(this.trackerEnd, TRACKER_START_AHEAD_M / gap);
    else this.trackerStart.copy(this.trackerEnd);
    this.boats[which].tracker.set(this.trackerStart, this.trackerEnd);
  }

  /** Update wind/current for a new race (conditions are randomized per race -- see game.ts's
   * randomConditions). Only the swell and ripple directions depend on wind direction; amplitude,
   * wavenumber and speed don't, so only the direction uniforms need updating.
   */
  setConditions(conditions: Conditions): void {
    this.conditions = conditions;
    this.waves = defaultSwell(conditions.wind_direction_rad);
    this.oceanMaterial.uniforms.uDirection0.value.set(...this.waves[0].direction);
    this.oceanMaterial.uniforms.uDirection1.value.set(...this.waves[1].direction);
    this.oceanMaterial.uniforms.uDirection2.value.set(...this.waves[2].direction);
    this.oceanMaterial.uniforms.uWindDirection.value.set(...this.waves[0].direction);
    this.wakes.player.clear(); // a new race starts from the origin, so the old trails are meaningless
    this.wakes.opponent.clear();
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
      applyForwardStroke(figure, side, sweep, lift);
    });
  }

  /** Animate the steersman's paddle for the current stroke: which side (0 = port, 1 =
   * starboard), which of the four stroke types, and phase in [0, 1) for progress through it.
   * This is the one crew member whose actual action the game controls, so it's the one animated
   * with the real stroke type rather than always-forward.
   */
  setStroke(which: BoatId, side: number, strokeType: number, phase: number): void {
    const figure = this.boats[which].steersman;
    const paddle = figure.paddle;
    const key = STROKE_TYPE_KEYS[strokeType] ?? 'forward';
    if (key === 'forward') {
      const { sweep, lift } = forwardStrokePose(phase);
      applyForwardStroke(figure, side, sweep, lift);
    } else {
      poseTorso(figure, 0); // no reach for these strokes; undo any lean left by a forward stroke
      // Draw/poke/rudder don't have a drive/recovery cycle in the physics -- just show the
      // blade planted on the working side with a small flourish through the stroke.
      const sideSign = side === 0 ? -1 : 1; // port -> local -Z, starboard -> local +Z
      const swing = Math.sin(Math.min(phase, 1) * Math.PI); // 0 at start/end, peak mid-stroke
      paddle.position.set(0, 0.65, sideSign * (0.55 + 0.15 * swing));
      paddle.rotation.x = -sideSign * SHAFT_CANT_RAD; // blade outboard of the hand, as in paddlePose
      paddle.rotation.z = -0.3 + 0.5 * swing;
    }

    const blade = paddle.userData.blade as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    blade.material.color.setHex(PADDLE_COLORS[key]);
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

    this.backdrop.position.copy(this.cameraPosition);

    // Recenter the (finite) ocean plane under the camera every frame -- an "infinite
    // ocean" trick -- so a race that covers more ground than that never sails off the edge into
    // empty space. The vertex shader samples the swell using this offset so the pattern stays
    // continuous as the mesh slides underneath it.
    this.ocean.position.set(this.cameraPosition.x, 0, this.cameraPosition.z);
    this.oceanMaterial.uniforms.uWorldOffset.value.set(this.ocean.position.x, this.ocean.position.z);

    // Each fleck is fixed in the WORLD, drifting only with the current (velocity is constant, so
    // this is just velocity * time), so as the camera follows a boat the flecks stream past it --
    // that is what shows the boat moving. Only the wrap is relative to the camera: a fleck that
    // falls outside the patch around the camera reappears on the opposite side.
    const [currentVx, currentVy] = currentVelocity(this.conditions);
    const driftX = currentVx * elapsedSeconds;
    const driftZ = -currentVy * elapsedSeconds; // sim +y -> world -z
    const twoR = FOAM_RADIUS_M * 2;
    const wrap = (v: number) => (((v % twoR) + twoR + FOAM_RADIUS_M) % twoR) - FOAM_RADIUS_M;
    const positions = this.foam.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < FOAM_COUNT; i++) {
      const x = this.cameraPosition.x + wrap(this.foamBaseXZ[i * 2] - driftX - this.cameraPosition.x);
      const z = this.cameraPosition.z + wrap(this.foamBaseXZ[i * 2 + 1] - driftZ - this.cameraPosition.z);
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
    this.boats.player.tracker.setResolution(width, height);
    this.boats.opponent.tracker.setResolution(width, height);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
