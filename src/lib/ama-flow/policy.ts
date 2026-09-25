// A from-scratch forward pass over the exported PPO policy MLP (src/data/ama-flow/policy.json),
// plus the scripted baseline steersman. Checked against ama-flow's own model.predict() via
// src/data/ama-flow/parity.json (see parity.test.ts) -- no onnxruntime needed, since the
// exported network is tiny (18 -> 64 -> 64 -> 8, tanh-activated).
import policyData from '../../data/ama-flow/policy.json';
import { ObsIndex, PRESETS } from './presets';

interface PolicyLayer {
  weight: number[][]; // [out_features, in_features]
  bias: number[];
  activation: 'tanh' | 'none';
}

interface PolicyJson {
  obs_size: number;
  num_actions: number;
  layers: PolicyLayer[];
}

const POLICY = policyData as PolicyJson;

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

/** The trained policy's deterministic action for an observation: argmax of the logits.
 * Equivalent to SB3's model.predict(obs, deterministic=True) for a Categorical action
 * distribution, since argmax is invariant to softmax.
 */
export function policyAction(obs: ArrayLike<number>): number {
  let x: number[] = Array.from(obs);
  for (const layer of POLICY.layers) {
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
