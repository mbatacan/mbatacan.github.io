import { GAME_CLASSES } from "../data/quickdraw-game-classes";
import type { Prediction } from "./sketch-classifier";

/** Pick a random game target, avoiding an immediate repeat of the current one. */
export function pickTarget(exclude?: string): string {
  const pool = exclude ? GAME_CLASSES.filter((c) => c !== exclude) : GAME_CLASSES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Whether the model's top prediction matches the target label. */
export function checkWin(predictions: Prediction[], target: string): boolean {
  return predictions.length > 0 && predictions[0].label === target;
}
