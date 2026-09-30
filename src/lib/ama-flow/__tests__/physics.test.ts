import { describe, expect, it } from 'vitest';
import { buildObservation, headingError } from '../physics';
import { PRESETS } from '../presets';
import type { Conditions, State } from '../physics';

const CONDITIONS: Conditions = {
  wind_speed_mps: 5,
  wind_direction_rad: 0,
  current_speed_mps: 0,
  current_direction_rad: 0,
};

describe('buildObservation targetHeadingRad', () => {
  it('defaults to 0, matching ama-flow\'s fixed TARGET_HEADING', () => {
    const state: State = [0, 0, 0.3, 3, 0, 0];
    const obs = buildObservation(state, CONDITIONS, PRESETS.crew, 0, null);
    const expectedError = headingError(state[2], 0);
    expect(obs[0]).toBeCloseTo(Math.sin(expectedError));
    expect(obs[1]).toBeCloseTo(Math.cos(expectedError));
  });

  it('rotates the heading-error observation to a non-zero target', () => {
    const state: State = [0, 0, 0.3, 3, 0, 0];
    const target = Math.PI / 4;
    const obs = buildObservation(state, CONDITIONS, PRESETS.crew, 0, null, target);
    const expectedError = headingError(state[2], target);
    expect(obs[0]).toBeCloseTo(Math.sin(expectedError));
    expect(obs[1]).toBeCloseTo(Math.cos(expectedError));
    // Holding exactly on the (rotated) target reads as zero error, regardless of world heading.
    const onTarget = buildObservation([0, 0, target, 3, 0, 0], CONDITIONS, PRESETS.crew, 0, null, target);
    expect(onTarget[0]).toBeCloseTo(0);
    expect(onTarget[1]).toBeCloseTo(1);
  });
});
