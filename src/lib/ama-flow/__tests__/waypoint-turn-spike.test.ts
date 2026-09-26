// A validation spike for the turn-buoy course: the trained policy was never explicitly tested
// on a sudden mid-episode target-heading change, only on holding a fixed target (with initial
// heading error sampled up to +-30 deg at reset). Since every observation is heading-relative or
// body-frame (see buildObservation's targetHeadingRad param), a rotated target should be the same
// task -- but this test empirically checks that, and gates how sharp the course's turns can be
// before scene.ts/game.ts build on the assumption.
import { describe, expect, it } from 'vitest';
import {
  advanceStroke,
  buildObservation,
  crewForce,
  headingError,
  strokeForce,
  type Conditions,
  type State,
} from '../physics';
import { policyAction } from '../policy';
import { PRESETS } from '../presets';
import { mulberry32 } from '../rng';

const CONDITIONS: Conditions = {
  wind_speed_mps: 10 * 0.514444,
  wind_direction_rad: Math.PI / 2,
  current_speed_mps: 1.0 * 0.514444,
  current_direction_rad: Math.PI / 2,
};
const LOST_HEADING_DEG = 90;
const LOST_HEADING_STROKES = 10;

/** Runs the model for `strokes`, switching the target heading to `targetAfterRad` after
 * `turnAtStroke`. Returns the per-stroke heading error (deg, measured against whichever target
 * was active that stroke) and whether it ever hit the lost-heading termination.
 */
function simulateTurn(targetAfterRad: number, turnAtStroke: number, strokes: number, seed: number) {
  let state: State = [0, 0, 0, PRESETS.initial_speed_mps, 0, 0];
  const rng = mulberry32(seed);
  let lastAction: number | null = null;
  let strokesLost = 0;
  let everLostHeading = false;
  const errorsDeg: number[] = [];

  for (let i = 0; i < strokes; i++) {
    const target = i < turnAtStroke ? 0 : targetAfterRad;
    const obs = buildObservation(state, CONDITIONS, PRESETS.crew, i, lastAction, target);
    const action = policyAction(obs);
    const force = strokeForce(PRESETS.stroke, action);
    const crew = crewForce(PRESETS.crew, i, rng);
    const totalForce: [number, number, number] = [
      force[0] + crew[0],
      force[1] + crew[1],
      force[2] + crew[2],
    ];
    state = advanceStroke(PRESETS.hull, PRESETS.ama, PRESETS.stroke, CONDITIONS, state, totalForce);
    const errorDeg = (headingError(state[2], target) * 180) / Math.PI;
    strokesLost = Math.abs(errorDeg) > LOST_HEADING_DEG ? strokesLost + 1 : 0;
    everLostHeading ||= strokesLost >= LOST_HEADING_STROKES;
    errorsDeg.push(errorDeg);
    lastAction = action;
  }
  return { errorsDeg, everLostHeading };
}

describe('turn-buoy course spike: mid-episode target heading change', () => {
  it('recovers from a 70 deg turn without ever losing heading', () => {
    const { errorsDeg, everLostHeading } = simulateTurn((70 * Math.PI) / 180, 30, 60, 0);
    expect(everLostHeading).toBe(false);
    const tail = errorsDeg.slice(-10);
    const rms = Math.sqrt(tail.reduce((sum, e) => sum + e * e, 0) / tail.length);
    expect(rms).toBeLessThan(20); // settled back near the new target well before the run ends
  });

  it('recovers from a 45 deg turn (a gentler fallback) across a few seeds', () => {
    for (const seed of [0, 1, 2]) {
      const { everLostHeading } = simulateTurn((45 * Math.PI) / 180, 30, 60, seed);
      expect(everLostHeading).toBe(false);
    }
  });

  // A wider probe (90/110/130/150/180 deg, not committed as a permanent test) found the model
  // holds up to ~90-110 deg without ever losing heading, then reliably loses it from ~130 deg on.
  // The turn-buoy course (game.ts's COURSE_WAYPOINTS) uses an 80 deg turn to stay well clear of
  // that cliff.
  it('still holds together at 90 deg, the practical limit found by a wider probe', () => {
    for (const seed of [0, 1, 2]) {
      const { everLostHeading } = simulateTurn((90 * Math.PI) / 180, 30, 70, seed);
      expect(everLostHeading).toBe(false);
    }
  });
});
