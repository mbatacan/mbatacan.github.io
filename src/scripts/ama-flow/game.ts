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

export const EPISODE_STROKES = 90; // ~100 s at 1x speed (stroke duration is 1.1 s)
const LOST_HEADING_DEG = 90;
const LOST_HEADING_STROKES = 10;

export interface BoatHistory {
  states: State[]; // n+1 entries: the initial state, then one per completed stroke
  actions: number[];
  headingErrorDeg: number[];
  strokesLost: number; // consecutive strokes over LOST_HEADING_RAD, for early termination
  terminated: boolean;
}

function initialState(): State {
  return [0, 0, 0, PRESETS.initial_speed_mps, 0, 0];
}

function freshHistory(): BoatHistory {
  return { states: [initialState()], actions: [], headingErrorDeg: [], strokesLost: 0, terminated: false };
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
    return h.terminated || h.actions.length >= EPISODE_STROKES;
  }

  observation(side: SideId): Float64Array {
    const h = this.histories[side];
    const state = h.states[h.states.length - 1];
    const lastAction = h.actions.length > 0 ? h.actions[h.actions.length - 1] : null;
    return buildObservation(state, this.conditions, PRESETS.crew, h.actions.length, lastAction);
  }

  /** Advance one boat by one stroke with the given steersman action. No-op once that boat's
   * episode has ended (lost heading, or EPISODE_STROKES reached).
   */
  step(side: SideId, action: number): void {
    const h = this.histories[side];
    if (this.isDone(side)) return;
    decodeAction(action); // throws on an out-of-range action, same as ama-flow's CanoeEnv
    const state = h.states[h.states.length - 1];
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
    const errorDeg = (headingError(nextState[2], 0) * 180) / Math.PI;
    h.states.push(nextState);
    h.actions.push(action);
    h.headingErrorDeg.push(errorDeg);
    h.strokesLost = Math.abs(errorDeg) > LOST_HEADING_DEG ? h.strokesLost + 1 : 0;
    h.terminated = h.strokesLost >= LOST_HEADING_STROKES;
  }

  /** RMS heading error in degrees over every completed stroke, for the results screen. */
  rmsHeadingErrorDeg(side: SideId): number {
    const errors = this.histories[side].headingErrorDeg;
    if (errors.length === 0) return 0;
    const meanSquare = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
    return Math.sqrt(meanSquare);
  }

  /** Net forward distance made good along the target heading (world +x), for the results screen. */
  distanceMadeGoodM(side: SideId): number {
    const states = this.histories[side].states;
    return states[states.length - 1][0] - states[0][0];
  }
}

export const policies: Record<'model' | 'baseline', Policy> = {
  model: policyAction,
  baseline: baselineAction,
};
