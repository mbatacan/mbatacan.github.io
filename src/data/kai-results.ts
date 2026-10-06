// Hand-copied from KAI's results/submissions.jsonl (public leaderboard, Getting-Started competitions).
// KAI's repo is private and its data isn't generated into this one, so update this by hand.

export interface KaiCompetition {
  id: string;
  name: string;
  metric: string;
  higherIsBetter: boolean;
  /** Public score needed to land in the top 10%. */
  top10Cutoff: number;
}

export interface KaiSubmission {
  round: string;
  competition: string;
  /** Cross-validation score KAI measured before submitting. */
  cv: number;
  publicScore: number;
  rank: number;
  teams: number;
  model: string;
}

export const KAI_ROUNDS = ['baseline', 'v2', 'candidate-pool', 'loop-v1', 'loop-v2b'] as const;

export const KAI_COMPETITIONS: KaiCompetition[] = [
  { id: 'home-data', name: 'home-data-for-ml-course', metric: 'MAE', higherIsBetter: false, top10Cutoff: 15109 },
  { id: 'house-prices', name: 'house-prices', metric: 'RMSLE', higherIsBetter: false, top10Cutoff: 0.1211 },
  { id: 'spaceship', name: 'spaceship-titanic', metric: 'accuracy', higherIsBetter: true, top10Cutoff: 0.8087 },
];

// The first home-data baseline and the candidate-pool round tuned on RMSLE rather than the real
// metric (MAE), so their cv column isn't comparable with the others.
export const KAI_SUBMISSIONS: KaiSubmission[] = [
  { round: 'baseline', competition: 'spaceship', cv: 0.8002, publicScore: 0.79401, rank: 1142, teams: 1588, model: 'LightGBM' },
  { round: 'baseline', competition: 'house-prices', cv: 0.1288, publicScore: 0.12828, rank: 1300, teams: 3817, model: 'LightGBM' },
  { round: 'baseline', competition: 'home-data', cv: 0.1278, publicScore: 14594.7136, rank: 318, teams: 3941, model: 'LightGBM' },
  { round: 'v2', competition: 'spaceship', cv: 0.8142, publicScore: 0.8043, rank: 586, teams: 1596, model: 'HistGradientBoosting' },
  { round: 'v2', competition: 'house-prices', cv: 0.1271, publicScore: 0.12817, rank: 1291, teams: 3850, model: 'LightGBM' },
  { round: 'v2', competition: 'home-data', cv: 15264.6053, publicScore: 14778.98015, rank: 319, teams: 3947, model: 'LightGBM' },
  { round: 'candidate-pool', competition: 'spaceship', cv: 0.8186, publicScore: 0.8036, rank: 579, teams: 1578, model: 'CatBoost' },
  { round: 'candidate-pool', competition: 'house-prices', cv: 0.119, publicScore: 0.12665, rank: 1158, teams: 3899, model: 'CatBoost' },
  { round: 'candidate-pool', competition: 'home-data', cv: 0.1196, publicScore: 14130.98059, rank: 262, teams: 3921, model: 'CatBoost' },
  { round: 'loop-v1', competition: 'spaceship', cv: 0.8149, publicScore: 0.80313, rank: 585, teams: 1580, model: 'CatBoost' },
  { round: 'loop-v1', competition: 'house-prices', cv: 0.1198, publicScore: 0.12539, rank: 1037, teams: 3922, model: 'CatBoost' },
  { round: 'loop-v1', competition: 'home-data', cv: 14376.5853, publicScore: 13617.28078, rank: 193, teams: 3934, model: 'CatBoost' },
  { round: 'loop-v2b', competition: 'spaceship', cv: 0.8197, publicScore: 0.80219, rank: 585, teams: 1575, model: 'CatBoost' },
  { round: 'loop-v2b', competition: 'house-prices', cv: 0.1187, publicScore: 0.12315, rank: 728, teams: 3915, model: 'CatBoost' },
  { round: 'loop-v2b', competition: 'home-data', cv: 14379.4659, publicScore: 13442.6001, rank: 168, teams: 3901, model: 'Ensemble (CatBoost, XGBoost, LightGBM, RandomForest, Ridge)' },
];

/** Leaderboard position as a percentage from the top (lower is better). */
export const topPercent = (s: KaiSubmission): number => (s.rank / s.teams) * 100;
