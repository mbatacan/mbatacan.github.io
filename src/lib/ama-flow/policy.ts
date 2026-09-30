// A from-scratch forward pass over the exported PPO policy MLP (src/data/ama-flow/policies/<name>.json),
// plus the scripted baseline steersman. Checked against ama-flow's own model.predict() via
// src/data/ama-flow/parity.json (see parity.test.ts) -- no onnxruntime needed, since the
// exported network is tiny (18 -> 64 -> 64 -> 8, tanh-activated).
import policyIndex from '../../data/ama-flow/policies/index.json';
import { ObsIndex, PRESETS } from './presets';

interface PolicyLayer {
  weight: number[][]; // [out_features, in_features]
  bias: number[];
  activation: 'tanh' | 'none';
}

/** What ama-flow's export writes about a checkpoint besides its weights (see export/web.py). */
export interface PolicyMeta {
  id: string;
  label: string;
  note: string;
  run_id: string;
  step: number;
  /** Unity Catalog registry version this checkpoint was exported from; absent for checkpoints
   * that aren't registered (the registry holds a run's latest checkpoint only). */
  registry?: { model: string; version: string; export_id: string };
  params: Record<string, string>; // the MLflow run's params, all strings
  eval_grid: { columns: string[]; data: (number | boolean)[][] };
  curve: Record<string, [number, number][]>; // metric -> [step, value], up to `step`
}

export interface PolicyEntry {
  obs_size: number;
  num_actions: number;
  layers: PolicyLayer[];
  meta: PolicyMeta;
  parity_obs_actions: { obs: number[]; action: number }[];
}

const POLICY_FILES = import.meta.glob<PolicyEntry>(
  ['../../data/ama-flow/policies/*.json', '!../../data/ama-flow/policies/index.json'],
  { eager: true, import: 'default' },
);

/** Which entry loads first, and the order the picker lists them in: set by ama-flow's manifest. */
export const DEFAULT_POLICY_ID: string = policyIndex.default;

/** Every published entry, in manifest order. */
export const POLICY_ENTRIES: PolicyEntry[] = policyIndex.order.map((id) => {
  const entry = POLICY_FILES[`../../data/ama-flow/policies/${id}.json`];
  if (!entry) {
    throw new Error(
      `policies/index.json lists "${id}" but policies/${id}.json is missing (found: ${Object.keys(POLICY_FILES).join(', ')})`,
    );
  }
  return entry;
});

const POLICY_BY_ID = new Map(POLICY_ENTRIES.map((entry) => [entry.meta.id, entry]));

function linear(weight: number[][], bias: number[], input: ArrayLike<number>): number[] {
  const out = new Array<number>(weight.length);
  for (let i = 0; i < weight.length; i++) {
    let sum = bias[i];
    const row = weight[i];
    for (let j = 0; j < row.length; j++) {
      sum += row[j] * input[j];
    }
    out[i] = sum;
  }
  return out;
}

function argmax(values: number[]): number {
  let bestIndex = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[bestIndex]) bestIndex = i;
  }
  return bestIndex;
}

/** A trained policy's deterministic action for an observation: argmax of the logits.
 * Equivalent to SB3's model.predict(obs, deterministic=True) for a Categorical action
 * distribution, since argmax is invariant to softmax.
 */
export function policyAction(obs: ArrayLike<number>, id: string = DEFAULT_POLICY_ID): number {
  const policy = POLICY_BY_ID.get(id);
  if (!policy) throw new Error(`unknown policy "${id}" (have: ${[...POLICY_BY_ID.keys()].join(', ')})`);
  let x: number[] = Array.from(obs);
  for (const layer of policy.layers) {
    x = linear(layer.weight, layer.bias, x);
    if (layer.activation === 'tanh') {
      x = x.map(Math.tanh);
    }
  }
  return argmax(x);
}

const YAW_RATE_GAIN = PRESETS.baseline.yaw_rate_gain;
const STEERING_THRESHOLD_RAD = PRESETS.baseline.steering_threshold_rad;
const NUM_STROKE_TYPES = 4;

/** PD steersman: matches ama_flow.agents.baseline.baseline_action exactly. */
export function baselineAction(obs: ArrayLike<number>): number {
  const error = Math.atan2(obs[ObsIndex.SIN_HEADING_ERROR], obs[ObsIndex.COS_HEADING_ERROR]);
  const signal = -error - YAW_RATE_GAIN * obs[ObsIndex.YAW_RATE];
  const side = signal > 0 ? 1 : 0; // STARBOARD : PORT
  const strokeType = Math.abs(signal) < STEERING_THRESHOLD_RAD ? 0 : 1; // FORWARD : DRAW
  return side * NUM_STROKE_TYPES + strokeType;
}
