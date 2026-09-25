// A from-scratch TypeScript port of ama-flow's physics core (ama_flow/physics/), so the game
// can run entirely client-side on this static site. Not a transpilation -- checked against
// ama-flow's own output via src/data/ama-flow/parity.json (see parity.test.ts).
//
// State is [x, y, psi, u, v, r]: world position (m), heading (rad, CCW from +x), and ground
// velocity in the body frame (u = surge, v = sway to port, r = yaw rate). Same conventions as
// ama_flow/physics/hull.py.
import { ObsIndex, PRESETS, Side, StrokeType, type CrewConfig, type HullConfig } from './presets';

export type State = [number, number, number, number, number, number];
export type Force = [number, number, number]; // [surge N, sway N, yaw N*m]

export interface Conditions {
  wind_speed_mps: number;
  wind_direction_rad: number;
  current_speed_mps: number;
  current_direction_rad: number;
}

/** Uniform random draws, in [low, high). Satisfied by the game's seeded RNG (see rng.ts). */
export interface Rng {
  uniform(low: number, high: number): number;
}

export const NUM_ACTIONS = PRESETS.num_actions;
const NUM_STROKE_TYPES = 4;

/** Interpolate between two states at fraction t in [0, 1], for smooth per-frame animation
 * between stroke ticks. Every field is lerped linearly except psi, which takes the shorter way
 * around the wrap (via headingError) -- matches ama-flow's own viz/render.py:lerp_state.
 */
export function lerpState(a: State, b: State, t: number): State {
  const out = lerpLinear(a, b, t);
  out[2] = a[2] + headingError(b[2], a[2]) * t;
  return out;
}

function lerpLinear(a: State, b: State, t: number): State {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    a[4] + (b[4] - a[4]) * t,
    a[5] + (b[5] - a[5]) * t,
  ];
}

/** Signed angle a - b, wrapped to (-pi, pi]. Matches ama_flow.physics.angles.heading_error. */
export function headingError(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** World-frame [x, y] -> body-frame [forward, lateral] at heading psi. Matches physics/frames.py. */
export function worldToBody(vectorWorld: [number, number], psi: number): [number, number] {
  const cosPsi = Math.cos(psi);
  const sinPsi = Math.sin(psi);
  return [
    cosPsi * vectorWorld[0] + sinPsi * vectorWorld[1],
    -sinPsi * vectorWorld[0] + cosPsi * vectorWorld[1],
  ];
}

export function windVelocity(conditions: Conditions): [number, number] {
  const angle = conditions.wind_direction_rad;
  return [conditions.wind_speed_mps * Math.cos(angle), conditions.wind_speed_mps * Math.sin(angle)];
}

export function currentVelocity(conditions: Conditions): [number, number] {
  const angle = conditions.current_direction_rad;
  return [
    conditions.current_speed_mps * Math.cos(angle),
    conditions.current_speed_mps * Math.sin(angle),
  ];
}

/** Body-frame wind force/moment on the hull. Matches physics/environment_forces.py:wind_force. */
function windForce(hull: HullConfig, conditions: Conditions, state: State): Force {
  const psi = state[2];
  const v = state[4];
  const wind = windVelocity(conditions);
  const windCross = -Math.sin(psi) * wind[0] + Math.cos(psi) * wind[1];
  const apparentCross = windCross - v;
  const sway =
    0.5 *
    hull.air_density_kg_m3 *
    hull.wind_drag_coeff *
    hull.windage_area_lateral_m2 *
    Math.abs(apparentCross) *
    apparentCross;
  return [0, sway, hull.wind_cp_offset_m * sway];
}

/** Time derivative of State given a total body-frame force and the world-frame current.
 * Matches physics/hull.py:Hull.derivatives.
 */
function hullDerivatives(
  hull: HullConfig,
  ama: { yaw_bias_coeff: number; sway_drag_extra_quadratic: number },
  state: State,
  force: Force,
  currentWorld: [number, number],
): State {
  const [, , psi, u, v, r] = state;
  const cosPsi = Math.cos(psi);
  const sinPsi = Math.sin(psi);
  const currentU = cosPsi * currentWorld[0] + sinPsi * currentWorld[1];
  const currentV = -sinPsi * currentWorld[0] + cosPsi * currentWorld[1];
  const uRel = u - currentU;
  const vRel = v - currentV;

  const xHydro = -(hull.damping_surge_linear + hull.damping_surge_quadratic * Math.abs(uRel)) * uRel;
  const swayQuadratic = hull.damping_sway_quadratic + ama.sway_drag_extra_quadratic;
  const yHydro = -(hull.damping_sway_linear + swayQuadratic * Math.abs(vRel)) * vRel;
  const nHydro = -(hull.damping_yaw_linear + hull.damping_yaw_quadratic * Math.abs(r)) * r;
  const nAma = ama.yaw_bias_coeff * uRel * Math.abs(uRel);

  const uDot = (xHydro + force[0] + hull.mass_kg * v * r) / (hull.mass_kg + hull.added_mass_surge_kg);
  const vDot = (yHydro + force[1] - hull.mass_kg * u * r) / (hull.mass_kg + hull.added_mass_sway_kg);
  const rDot =
    (nHydro + nAma + force[2]) / (hull.yaw_inertia_kg_m2 + hull.added_inertia_yaw_kg_m2);

  return [u * cosPsi - v * sinPsi, u * sinPsi + v * cosPsi, r, uDot, vDot, rDot];
}

function addScaled(a: State, b: State, scale: number): State {
  return [
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
    a[3] + b[3] * scale,
    a[4] + b[4] * scale,
    a[5] + b[5] * scale,
  ];
}

/** Classical RK4, one step of size dt. Matches physics/integrator.py:rk4_step. */
function rk4Step(f: (s: State) => State, y: State, dt: number): State {
  const k1 = f(y);
  const k2 = f(addScaled(y, k1, 0.5 * dt));
  const k3 = f(addScaled(y, k2, 0.5 * dt));
  const k4 = f(addScaled(y, k3, dt));
  return [
    y[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    y[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    y[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    y[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    y[4] + (dt / 6) * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4]),
    y[5] + (dt / 6) * (k1[5] + 2 * k2[5] + 2 * k3[5] + k4[5]),
  ];
}

/** Split a Discrete(8) action into (side, strokeType): action = side * 4 + strokeType.
 * Matches physics/strokes.py:decode_action.
 */
export function decodeAction(action: number): { side: number; strokeType: number } {
  if (!(action >= 0 && action < NUM_ACTIONS)) {
    throw new RangeError(`action must be in [0, ${NUM_ACTIONS}), got ${action}`);
  }
  return { side: Math.floor(action / NUM_STROKE_TYPES), strokeType: action % NUM_STROKE_TYPES };
}

const STROKE_TYPE_KEYS = ['forward', 'draw', 'poke', 'rudder'] as const;

/** Mean body-frame force for the steersman's action. Matches physics/strokes.py:stroke_force. */
export function strokeForce(stroke: PRESETS_STROKE, action: number): Force {
  const { side, strokeType } = decodeAction(action);
  const impulse = stroke[STROKE_TYPE_KEYS[strokeType]];
  const mirror = side === Side.PORT ? 1 : -1;
  return [
    impulse.surge_ns / stroke.duration_s,
    (mirror * impulse.sway_ns) / stroke.duration_s,
    (mirror * impulse.yaw_nms) / stroke.duration_s,
  ];
}

type PRESETS_STROKE = typeof PRESETS.stroke;

export function hutCount(crew: CrewConfig, strokeIndex: number): number {
  return Math.floor(strokeIndex / crew.switch_period_strokes);
}

export function hutPhase(crew: CrewConfig, strokeIndex: number): number {
  return strokeIndex % crew.switch_period_strokes;
}

/** Side the given seat (0-indexed) paddles on for this stroke. Matches strokes.py:seat_side. */
export function seatSide(crew: CrewConfig, seat: number, strokeIndex: number): number {
  const base = crew.seat_sides[seat];
  return hutCount(crew, strokeIndex) % 2 === 0 ? base : 1 - base;
}

/** Mean body-frame force from seats 1-5. Matches physics/strokes.py:crew_force. */
export function crewForce(crew: CrewConfig, strokeIndex: number, rng: Rng): Force {
  let thrust = 0;
  let yaw = 0;
  crew.seat_force_ranges_n.forEach(([low, high], seat) => {
    const force = rng.uniform(low, high);
    thrust += force;
    const awayFromPaddle = seatSide(crew, seat, strokeIndex) === Side.PORT ? -1 : 1;
    yaw += awayFromPaddle * crew.paddle_offset_m * force;
  });
  return [thrust, 0, yaw];
}

/** Integrate one stroke: constant paddle force plus wind, sub-stepped at stroke.dt_s.
 * Matches physics/strokes.py:advance_stroke.
 */
export function advanceStroke(
  hull: HullConfig,
  ama: { yaw_bias_coeff: number; sway_drag_extra_quadratic: number },
  stroke: PRESETS_STROKE,
  conditions: Conditions,
  state: State,
  paddleForce: Force,
): State {
  const current = currentVelocity(conditions);
  const steps = Math.round(stroke.duration_s / stroke.dt_s);
  let s = state;
  for (let i = 0; i < steps; i++) {
    s = rk4Step((y) => {
      const wf = windForce(hull, conditions, y);
      const totalForce: Force = [
        paddleForce[0] + wf[0],
        paddleForce[1] + wf[1],
        paddleForce[2] + wf[2],
      ];
      return hullDerivatives(hull, ama, y, totalForce, current);
    }, s, stroke.dt_s);
  }
  return s;
}

/** Build the observation vector for a state, matching envs/canoe_env.py:build_observation. */
export function buildObservation(
  state: State,
  conditions: Conditions,
  crew: CrewConfig,
  strokeIndex: number,
  lastAction: number | null,
): Float64Array {
  const obs = new Float64Array(PRESETS.obs_size);
  const error = headingError(state[2], 0.0);
  obs[ObsIndex.SIN_HEADING_ERROR] = Math.sin(error);
  obs[ObsIndex.COS_HEADING_ERROR] = Math.cos(error);
  obs[ObsIndex.YAW_RATE] = state[5];
  obs[ObsIndex.SURGE] = state[3];
  obs[ObsIndex.SWAY] = state[4];

  const psi = state[2];
  const windBody = worldToBody(windVelocity(conditions), psi);
  const currentBody = worldToBody(currentVelocity(conditions), psi);
  obs[ObsIndex.WIND_FORWARD] = windBody[0];
  obs[ObsIndex.WIND_LATERAL] = windBody[1];
  obs[ObsIndex.CURRENT_FORWARD] = currentBody[0];
  obs[ObsIndex.CURRENT_LATERAL] = currentBody[1];

  if (lastAction !== null) {
    obs[ObsIndex.LAST_ACTION_START + lastAction] = 1.0;
  }

  obs[ObsIndex.HUT_PHASE] = hutPhase(crew, strokeIndex) / crew.switch_period_strokes;
  return obs;
}

export { StrokeType };
