// Drives the physics loop (one CanoeEnv-equivalent episode) for the Watch/Play modes, and
// hands per-frame boat positions to scene.ts. Runs entirely client-side.
import {
  advanceStroke,
  buildObservation,
  crewForce,
  decodeAction,
  headingError,
  strokeForce,
  type Conditions,
  type State,
} from '../../lib/ama-flow/physics';
import { baselineAction, policyAction } from '../../lib/ama-flow/policy';
import { PRESETS } from '../../lib/ama-flow/presets';
import { mulberry32 } from '../../lib/ama-flow/rng';

export type SideId = 'player' | 'opponent';
export type Policy = (obs: Float64Array) => number;

export const DEFAULT_CONDITIONS: Conditions = {
  wind_speed_mps: 10 * 0.514444,
  wind_direction_rad: Math.PI / 2,
  current_speed_mps: 1.0 * 0.514444,
  current_direction_rad: Math.PI / 2,
};

/** DEFAULT_CONDITIONS's speeds with a random wind/current direction, drawn independently and
 * uniformly like ama-flow's own CanoeEnv.reset() (canoe_env.py's reset samples both directions
 * from Uniform(-pi, pi)). A fixed direction always drifts the bow the same way, so both the
 * model and the baseline settle into the same one or two corrective strokes every race --
 * randomizing per race is what actually varies which strokes get used, not a reward change.
 */
export function randomConditions(seed: number): Conditions {
  const rng = mulberry32(seed);
  return {
    wind_speed_mps: DEFAULT_CONDITIONS.wind_speed_mps,
    wind_direction_rad: rng.uniform(-Math.PI, Math.PI),
    current_speed_mps: DEFAULT_CONDITIONS.current_speed_mps,
    current_direction_rad: rng.uniform(-Math.PI, Math.PI),
  };
}

export const EPISODE_STROKES = 90; // ~100 s at 1x speed (stroke duration is 1.1 s), also the timeout
const LOST_HEADING_DEG = 90;
const LOST_HEADING_STROKES = 10;

// A short turn-buoy course rather than a straight line, so the boat has to hold two different
// headings (and therefore use both port and starboard corrective strokes) instead of drifting
// the same way all race. The 80 deg turn at the buoy (two 40 deg legs off world +x) is chosen
// from src/lib/ama-flow/__tests__/waypoint-turn-spike.test.ts, which found the trained model
// holds together up to ~90-110 deg of sudden mid-episode target change before reliably losing
// heading past ~130 deg -- 80 deg leaves it comfortable margin.
// 100m/leg (200m total) rather than the ~297m a straight line covers in EPISODE_STROKES: the
// turn costs real distance (heading error spikes and takes strokes to recover, so less thrust
// goes to forward progress for a while), confirmed empirically -- a 150m/leg course only reached
// ~255-257m of its 300m total by stroke 90, finishing well short.
const COURSE_LEG_LENGTH_M = 100;
const COURSE_TURN_BEARING_DEG = 40;
export const COURSE_WAYPOINTS: [number, number][] = (() => {
  const b = (COURSE_TURN_BEARING_DEG * Math.PI) / 180;
  const turnBuoy: [number, number] = [COURSE_LEG_LENGTH_M * Math.cos(b), COURSE_LEG_LENGTH_M * Math.sin(b)];
  const finish: [number, number] = [
    turnBuoy[0] + COURSE_LEG_LENGTH_M * Math.cos(-b),
    turnBuoy[1] + COURSE_LEG_LENGTH_M * Math.sin(-b),
  ];
  return [turnBuoy, finish];
})();

/** Total course length (sum of leg lengths, start -> each waypoint in order), for the HUD
 * progress bar's denominator.
 */
export const COURSE_LENGTH_M = (() => {
  let total = 0;
  let prev: [number, number] = [0, 0];
  for (const wp of COURSE_WAYPOINTS) {
    total += Math.hypot(wp[0] - prev[0], wp[1] - prev[1]);
    prev = wp;
  }
  return total;
})();

function legStart(waypointIndex: number): [number, number] {
  return waypointIndex === 0 ? [0, 0] : COURSE_WAYPOINTS[waypointIndex - 1];
}

function legLengthM(legIndex: number): number {
  const start = legStart(legIndex);
  const end = COURSE_WAYPOINTS[legIndex];
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

// Each leg's bearing is fixed once (start -> waypoint), NOT recomputed from the boat's current
// position every stroke. An early version recomputed the bearing to the fixed waypoint each
// stroke, which is unstable once the boat gets close to (or drifts past) the point: a small
// lateral offset near the waypoint swings the required bearing through a huge, fast-changing arc
// (confirmed empirically -- 35/60 random-seed races lost heading entirely, even though a fixed,
// scripted heading flip of the same size was safe in waypoint-turn-spike.test.ts). A fixed
// per-leg bearing has no such singularity.
const LEG_BEARINGS_RAD: number[] = COURSE_WAYPOINTS.map((wp, i) => {
  const start = legStart(i);
  return Math.atan2(wp[1] - start[1], wp[0] - start[0]);
});

/** How far along the current leg (clamped to [0, leg length]) a position has progressed,
 * projected onto the leg's fixed bearing. Used both to decide when a leg is "reached" (>= the
 * leg length) and for distanceMadeGoodM's partial-leg progress.
 */
function alongLegM(legIndex: number, position: [number, number]): number {
  const start = legStart(legIndex);
  const end = COURSE_WAYPOINTS[legIndex];
  const legVector = [end[0] - start[0], end[1] - start[1]];
  const length = legLengthM(legIndex);
  const positionVector = [position[0] - start[0], position[1] - start[1]];
  const projectionM = (positionVector[0] * legVector[0] + positionVector[1] * legVector[1]) / length;
  return Math.max(0, Math.min(projectionM, length));
}

export interface BoatHistory {
  states: State[]; // n+1 entries: the initial state, then one per completed stroke
  actions: number[];
  headingErrorDeg: number[]; // measured against whichever waypoint was the target that stroke
  strokesLost: number; // consecutive strokes over LOST_HEADING_RAD, for early termination
  terminated: boolean;
  waypointIndex: number; // index into COURSE_WAYPOINTS of the boat's current target
  finished: boolean; // captured the course's final waypoint
}

function initialState(): State {
  return [0, 0, 0, PRESETS.initial_speed_mps, 0, 0];
}

function freshHistory(): BoatHistory {
  return {
    states: [initialState()],
    actions: [],
    headingErrorDeg: [],
    strokesLost: 0,
    terminated: false,
    waypointIndex: 0,
    finished: false,
  };
}

/** One ama-flow episode with two independent boats (e.g. player vs a policy, or policy vs
 * baseline), stepped one stroke at a time. Both boats see the identical crew-force noise
 * sequence each stroke (a fresh RNG per boat, but reseeded together at reset()), so neither
 * side has a noise advantage -- the same fairness guarantee ama-flow's own --compare-baseline
 * gives the pygame ghost replay.
 */
export class Duel {
  readonly conditions: Conditions;
  private crewRngs: Record<SideId, ReturnType<typeof mulberry32>>;
  private histories: Record<SideId, BoatHistory>;
  private seed: number;

  constructor(conditions: Conditions = DEFAULT_CONDITIONS, seed = 0) {
    this.conditions = conditions;
    this.seed = seed;
    this.crewRngs = { player: mulberry32(seed), opponent: mulberry32(seed) };
    this.histories = { player: freshHistory(), opponent: freshHistory() };
  }

  reset(seed = this.seed): void {
    this.seed = seed;
    this.crewRngs = { player: mulberry32(seed), opponent: mulberry32(seed) };
    this.histories = { player: freshHistory(), opponent: freshHistory() };
  }

  history(side: SideId): BoatHistory {
    return this.histories[side];
  }

  isDone(side: SideId): boolean {
    const h = this.histories[side];
    return h.terminated || h.finished || h.actions.length >= EPISODE_STROKES;
  }

  /** The current leg's fixed bearing (see LEG_BEARINGS_RAD -- NOT recomputed from the boat's
   * position). Every observation is either relative to this (heading error) or body-frame (wind,
   * current), so a rotated target is the same task the model trained on, just rotated -- see
   * physics.ts's buildObservation and the waypoint-turn-spike test that checked this empirically.
   */
  currentTargetHeadingRad(side: SideId): number {
    const h = this.histories[side];
    return LEG_BEARINGS_RAD[Math.min(h.waypointIndex, LEG_BEARINGS_RAD.length - 1)];
  }

  /** The boat's current target waypoint, for the scene's dashed tracker line. */
  currentWaypoint(side: SideId): [number, number] {
    const h = this.histories[side];
    return COURSE_WAYPOINTS[Math.min(h.waypointIndex, COURSE_WAYPOINTS.length - 1)];
  }

  observation(side: SideId): Float64Array {
    const h = this.histories[side];
    const state = h.states[h.states.length - 1];
    const lastAction = h.actions.length > 0 ? h.actions[h.actions.length - 1] : null;
    return buildObservation(
      state,
      this.conditions,
      PRESETS.crew,
      h.actions.length,
      lastAction,
      this.currentTargetHeadingRad(side),
    );
  }

  /** Advance one boat by one stroke with the given steersman action. No-op once that boat's
   * episode has ended (lost heading, reached EPISODE_STROKES, or finished the course).
   */
  step(side: SideId, action: number): void {
    const h = this.histories[side];
    if (this.isDone(side)) return;
    decodeAction(action); // throws on an out-of-range action, same as ama-flow's CanoeEnv
    const state = h.states[h.states.length - 1];
    const targetHeadingRad = this.currentTargetHeadingRad(side);
    const force = strokeForce(PRESETS.stroke, action);
    const crew = crewForce(PRESETS.crew, h.actions.length, this.crewRngs[side]);
    const totalForce: [number, number, number] = [
      force[0] + crew[0],
      force[1] + crew[1],
      force[2] + crew[2],
    ];
    const nextState = advanceStroke(
      PRESETS.hull,
      PRESETS.ama,
      PRESETS.stroke,
      this.conditions,
      state,
      totalForce,
    );
    const errorDeg = (headingError(nextState[2], targetHeadingRad) * 180) / Math.PI;
    h.states.push(nextState);
    h.actions.push(action);
    h.headingErrorDeg.push(errorDeg);
    h.strokesLost = Math.abs(errorDeg) > LOST_HEADING_DEG ? h.strokesLost + 1 : 0;
    h.terminated = h.strokesLost >= LOST_HEADING_STROKES;

    // Advance once the boat has covered the current leg's full length along its fixed bearing --
    // not proximity to the waypoint's exact (x, y), which is unstable near/past the point (see
    // LEG_BEARINGS_RAD's comment).
    if (alongLegM(h.waypointIndex, [nextState[0], nextState[1]]) >= legLengthM(h.waypointIndex)) {
      if (h.waypointIndex === COURSE_WAYPOINTS.length - 1) {
        h.finished = true;
      } else {
        h.waypointIndex += 1;
      }
    }
  }

  /** RMS heading error in degrees over every completed stroke, for the results screen. */
  rmsHeadingErrorDeg(side: SideId): number {
    const errors = this.histories[side].headingErrorDeg;
    if (errors.length === 0) return 0;
    const meanSquare = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
    return Math.sqrt(meanSquare);
  }

  /** Distance made good along the course: full lengths of completed legs, plus the boat's
   * forward progress (projected, clamped >= 0) along its current leg. A single number that stays
   * comparable across the whole multi-leg course, for the results screen and the progress bar.
   */
  distanceMadeGoodM(side: SideId): number {
    const h = this.histories[side];
    const position = h.states[h.states.length - 1];
    let progress = 0;
    for (let i = 0; i < h.waypointIndex; i++) progress += legLengthM(i);
    if (h.waypointIndex < COURSE_WAYPOINTS.length) {
      progress += alongLegM(h.waypointIndex, [position[0], position[1]]);
    }
    return progress;
  }
}

export const policies: Record<'model' | 'baseline', Policy> = {
  model: policyAction,
  baseline: baselineAction,
};
