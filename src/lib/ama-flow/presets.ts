// Typed accessors over the exported OC6 presets (ama-flow's `oc6_*_config()`), the single
// source of truth for both the Python simulator and this TS port. See ama-flow's
// ama_flow/export/web.py for how this JSON is produced.
import presetsData from '../../data/ama-flow/presets.json';

export interface HullConfig {
  mass_kg: number;
  yaw_inertia_kg_m2: number;
  added_mass_surge_kg: number;
  added_mass_sway_kg: number;
  added_inertia_yaw_kg_m2: number;
  damping_surge_linear: number;
  damping_surge_quadratic: number;
  damping_sway_linear: number;
  damping_sway_quadratic: number;
  damping_yaw_linear: number;
  damping_yaw_quadratic: number;
  windage_area_lateral_m2: number;
  wind_drag_coeff: number;
  air_density_kg_m3: number;
  wind_cp_offset_m: number;
}

export interface AmaConfig {
  yaw_bias_coeff: number;
  sway_drag_extra_quadratic: number;
}

export interface StrokeImpulse {
  surge_ns: number;
  sway_ns: number;
  yaw_nms: number;
}

export interface StrokeConfig {
  duration_s: number;
  dt_s: number;
  forward: StrokeImpulse;
  draw: StrokeImpulse;
  poke: StrokeImpulse;
  rudder: StrokeImpulse;
}

export interface CrewConfig {
  seat_force_ranges_n: number[][]; // each [low, high]
  seat_sides: number[]; // 0 = PORT, 1 = STARBOARD, per Side below
  paddle_offset_m: number;
  switch_period_strokes: number;
}

export interface Presets {
  hull: HullConfig;
  ama: AmaConfig;
  stroke: StrokeConfig;
  crew: CrewConfig;
  baseline: { yaw_rate_gain: number; steering_threshold_rad: number };
  obs_index: Record<string, number>;
  obs_size: number;
  num_actions: number;
  stroke_types: Record<string, number>;
  sides: Record<string, number>;
  initial_speed_mps: number;
}

export const PRESETS = presetsData as Presets;

export const Side = { PORT: 0, STARBOARD: 1 } as const;
export const StrokeType = { FORWARD: 0, DRAW: 1, POKE: 2, RUDDER: 3 } as const;

export const ObsIndex = {
  SIN_HEADING_ERROR: PRESETS.obs_index.SIN_HEADING_ERROR,
  COS_HEADING_ERROR: PRESETS.obs_index.COS_HEADING_ERROR,
  YAW_RATE: PRESETS.obs_index.YAW_RATE,
  SURGE: PRESETS.obs_index.SURGE,
  SWAY: PRESETS.obs_index.SWAY,
  WIND_FORWARD: PRESETS.obs_index.WIND_FORWARD,
  WIND_LATERAL: PRESETS.obs_index.WIND_LATERAL,
  CURRENT_FORWARD: PRESETS.obs_index.CURRENT_FORWARD,
  CURRENT_LATERAL: PRESETS.obs_index.CURRENT_LATERAL,
  LAST_ACTION_START: PRESETS.obs_index.LAST_ACTION_START,
  HUT_PHASE: PRESETS.obs_index.HUT_PHASE,
} as const;
