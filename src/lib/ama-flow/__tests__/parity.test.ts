// Checks this TS port against ama-flow's own Python implementation, via golden data exported
// by ama_flow/export/web.py. This is the real correctness contract for physics.ts/policy.ts --
// not just "it compiles and looks like the Python."
import { describe, expect, it } from 'vitest';
import parityData from '../../../data/ama-flow/parity.json';
import { advanceStroke, buildObservation, type Conditions, type State } from '../physics';
import { baselineAction, policyAction } from '../policy';
import { PRESETS } from '../presets';

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
  policy_obs_actions: ParityObsAction[];
  baseline_obs_actions: ParityObsAction[];
}

const PARITY = parityData as ParityData;

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

describe('advanceStroke matches ama-flow physics', () => {
  for (const trajectory of PARITY.trajectories) {
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

describe('buildObservation matches ama-flow', () => {
  for (const trajectory of PARITY.trajectories) {
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

describe('policyAction matches the trained model', () => {
  it('agrees with model.predict(obs, deterministic=True) on every parity pair', () => {
    for (const { obs, action } of PARITY.policy_obs_actions) {
      expect(policyAction(obs)).toBe(action);
    }
  });
});

describe('baselineAction matches ama_flow.agents.baseline.baseline_action', () => {
  it('agrees on every parity pair', () => {
    for (const { obs, action } of PARITY.baseline_obs_actions) {
      expect(baselineAction(obs)).toBe(action);
    }
  });
});
