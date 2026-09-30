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
import { baselineAction, DEFAULT_POLICY_ID, policyAction } from '../../lib/ama-flow/policy';
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
// the same way all race. Leg 1's bearing is 0 deg -- exactly ama-flow's own TARGET_HEADING, so
// the race starts in the same regime the model was actually benchmarked in, with no artificial
// transient before the boat has even settled. An earlier version used two 40 deg legs off +x,
// which put an unnecessary 40 deg offset right at the start on top of the turn -- both
// transients stacked made the RMS error shown in the HUD/results look far worse than the
// model's actual steady-state control (which holds within a few degrees on a straight leg).
//
// The buoy turn's angle was swept empirically (100 random-seed races per angle):
//   50 deg: 0 lost, 100 finished, avg RMS 16.0   <- chosen
//   60 deg: 0 lost, 100 finished, avg RMS 20.0
//   70 deg: 0 lost,  99 finished, avg RMS 24.2
//   80 deg: 0 lost,  91 finished, avg RMS 28.6
// None of these ever lose heading (the model can physically survive up to ~90-110 deg per
// src/lib/ama-flow/__tests__/waypoint-turn-spike.test.ts), but recovery from a sharp turn takes
// real strokes -- an 80 deg turn eats so much of the remaining leg that some races time out
// before reaching the finish, and the transient dominates the RMS the whole way. 50 deg is a
// real, visible turn that still leaves room to fully recover and finish cleanly.
// Leg lengths (200m total) are shorter than the ~297m a straight line covers in EPISODE_STROKES:
// the turn costs real distance (heading error spikes and takes strokes to recover, so less thrust
// goes to forward progress for a while), confirmed empirically -- a 150m/leg course only reached
// ~255-257m of its 300m total by stroke 90, finishing well short.
const COURSE_LEGS: { bearingDeg: number; lengthM: number }[] = [
  { bearingDeg: 0, lengthM: 120 },
  { bearingDeg: -50, lengthM: 80 },
];
export const COURSE_WAYPOINTS: [number, number][] = (() => {
  const waypoints: [number, number][] = [];
  let position: [number, number] = [0, 0];
  for (const leg of COURSE_LEGS) {
    const rad = (leg.bearingDeg * Math.PI) / 180;
    position = [position[0] + leg.lengthM * Math.cos(rad), position[1] + leg.lengthM * Math.sin(rad)];
    waypoints.push(position);
  }
  return waypoints;
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

/** Perpendicular (signed) distance from a position to the leg's fixed bearing line -- how far
 * off the rhumb line the boat is, independent of how far along it the boat has progressed.
 * alongLegM alone lets a boat that cuts inside a turn (or passes wide of the finish gate) still
 * register as having reached the waypoint, since crossing the perpendicular line at the leg's end
 * doesn't require being anywhere near the mark itself -- see the gating in step().
 */
function crossTrackM(legIndex: number, position: [number, number]): number {
  const start = legStart(legIndex);
  const end = COURSE_WAYPOINTS[legIndex];
  const legVector = [end[0] - start[0], end[1] - start[1]];
  const length = legLengthM(legIndex);
  const positionVector = [position[0] - start[0], position[1] - start[1]];
  return (positionVector[0] * legVector[1] - positionVector[1] * legVector[0]) / length;
}

// How close to a turn buoy's actual position a boat must be (measured perpendicular to the
// rhumb line, at the moment it reaches the leg's forward extent) to count as having rounded it.
// Neither the trained model nor the scripted baseline corrects for cross-track drift -- both only
// hold a heading, so cross-wind/current leeway pushes them steadily off the rhumb line with
// nothing to pull them back. Measured empirically (60 random-seed episodes per policy, logging
// cross-track distance at the moment each leg's forward-progress threshold is first reached):
//   leg 0 (the turn buoy):  p50 ~11-17m, p80 ~21-28m, p90 ~30m
//   leg 1 (the finish):     p50 ~32m,    p80 ~49-51m, p90 ~52-55m (then a long tail past 100m --
//                           unlucky wind/current seeds that drift wildly and shouldn't count as a
//                           real finish)
// A radius near either leg's own p50 fails about half the time (confirmed: a first attempt at 15m
// stalled most races at the first buoy, tied on distance and decided by the RMS-error tiebreak --
// this is what made the baseline look like it had started winning far more often after the gate
// went in, rather than any change in the model's actual performance). These are set past each
// leg's p90 instead, generous enough that most races complete while still ruling out the extreme
// drift tail and the original bug (crossing the rhumb line's infinite extension while nowhere near
// the mark). The finish gate is wider than the turn buoy because it naturally accumulates more
// drift (it's the leg after the turn, and longer) -- see scene.ts's buildFinishLine, which sizes
// the visible two-buoy gate to this same constant so what's drawn matches what's enforced.
export const TURN_ROUNDING_RADIUS_M = 30;
export const FINISH_GATE_HALF_WIDTH_M = 55;

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
    // LEG_BEARINGS_RAD's comment) -- AND is within the mark's rounding tolerance (the finish
    // gate's, if this is the last waypoint) of that fixed bearing line. Forward progress alone
    // isn't enough: it's satisfied by crossing the line extended infinitely to either side, which
    // let a boat cut inside a turn buoy, or cross the finish well outside the two visible finish
    // buoys, and still register as having reached the mark.
    const isFinalLeg = h.waypointIndex === COURSE_WAYPOINTS.length - 1;
    const toleranceM = isFinalLeg ? FINISH_GATE_HALF_WIDTH_M : TURN_ROUNDING_RADIUS_M;
    const reachedForward =
      alongLegM(h.waypointIndex, [nextState[0], nextState[1]]) >= legLengthM(h.waypointIndex);
    const withinTolerance =
      Math.abs(crossTrackM(h.waypointIndex, [nextState[0], nextState[1]])) <= toleranceM;
    if (reachedForward && withinTolerance) {
      if (isFinalLeg) {
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

let selectedPolicyId = DEFAULT_POLICY_ID;

/** Choose which published checkpoint `policies.model` runs; policyAction throws on unknown ids. */
export function setSelectedPolicy(id: string): void {
  selectedPolicyId = id;
}

export const policies: Record<'model' | 'baseline', Policy> = {
  model: (obs) => policyAction(obs, selectedPolicyId),
  baseline: baselineAction,
};
