// Checks this TS port against ama-flow's own Python implementation, via golden data exported
// by ama_flow/export/web.py. This is the real correctness contract for physics.ts/policy.ts --
// not just "it compiles and looks like the Python."
import { describe, expect, it } from 'vitest';
import parityOc6 from '../../../data/ama-flow/parity.json';
import parityOc1 from '../../../data/ama-flow/parity-oc1.json';
import { advanceStroke, buildObservation, type Conditions, type State } from '../physics';
import { ALL_POLICY_ENTRIES, baselineAction, policyAction } from '../policy';
import { presetsFor, type CanoeId } from '../presets';

interface ParityStep {
  action: number;
  force: [number, number, number];
  state_before: State;
  state_after: State;
  obs_after: number[];
}

interface ParityTrajectory {
  conditions: Conditions;
  seed: number;
  steps: ParityStep[];
}

interface ParityObsAction {
  obs: number[];
  action: number;
}

interface ParityData {
  trajectories: ParityTrajectory[];
  baseline_obs_actions: ParityObsAction[];
}

const PARITY_BY_CANOE: [CanoeId, ParityData][] = [
  ['oc6', parityOc6 as ParityData],
  ['oc1', parityOc1 as ParityData],
];
const PARITY = PARITY_BY_CANOE[0][1];

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

describe.each(PARITY_BY_CANOE)('%s: advanceStroke matches ama-flow physics', (canoe, parity) => {
  const PRESETS = presetsFor(canoe);
  for (const trajectory of parity.trajectories) {
    it(`reproduces state_after for every step at seed=${trajectory.seed}`, () => {
      for (const step of trajectory.steps) {
        const actual = advanceStroke(
          PRESETS.hull,
          PRESETS.ama,
          PRESETS.stroke,
          trajectory.conditions,
          step.state_before,
          step.force,
        );
        actual.forEach((value, i) => {
          expect(approxEqual(value, step.state_after[i])).toBe(true);
        });
      }
    });
  }
});

describe.each(PARITY_BY_CANOE)('%s: buildObservation matches ama-flow', (canoe, parity) => {
  const PRESETS = presetsFor(canoe);
  for (const trajectory of parity.trajectories) {
    it(`reproduces obs_after for every step at seed=${trajectory.seed}`, () => {
      trajectory.steps.forEach((step, i) => {
        const obs = buildObservation(
          step.state_after,
          trajectory.conditions,
          PRESETS.crew,
          i + 1,
          step.action,
        );
        step.obs_after.forEach((value, j) => {
          expect(approxEqual(obs[j], value)).toBe(true);
        });
      });
    });
  }
});

describe('policyAction matches each trained model', () => {
  for (const entry of ALL_POLICY_ENTRIES) {
    it(`${entry.meta.id} agrees with model.predict(obs, deterministic=True) on every parity pair`, () => {
      expect(entry.parity_obs_actions.length).toBeGreaterThan(0);
      for (const { obs, action } of entry.parity_obs_actions) {
        expect(policyAction(obs, entry.meta.id)).toBe(action);
      }
    });
  }
});

describe('baselineAction matches ama_flow.agents.baseline.baseline_action', () => {
  it('agrees on every parity pair', () => {
    for (const { obs, action } of PARITY.baseline_obs_actions) {
      expect(baselineAction(obs)).toBe(action);
    }
  });
});
