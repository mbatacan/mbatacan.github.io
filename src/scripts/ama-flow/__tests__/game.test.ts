import { describe, expect, it } from 'vitest';
import { Duel, EPISODE_STROKES, policies } from '../game';

describe('Duel', () => {
  it('gives both sides identical crew-force noise for identical actions (a fair race)', () => {
    const duel = new Duel();
    for (let i = 0; i < 10; i++) {
      duel.step('player', 0); // always forward-port
      duel.step('opponent', 0);
    }
    expect(duel.history('player').states).toEqual(duel.history('opponent').states);
  });

  it("runs the baseline against itself to a tie (same conditions, same noise)", () => {
    const duel = new Duel();
    while (!duel.isDone('player')) {
      duel.step('player', policies.baseline(duel.observation('player')));
    }
    while (!duel.isDone('opponent')) {
      duel.step('opponent', policies.baseline(duel.observation('opponent')));
    }
    expect(duel.rmsHeadingErrorDeg('player')).toBeCloseTo(duel.rmsHeadingErrorDeg('opponent'), 9);
  });

  it('stops advancing a side once its episode is done', () => {
    const duel = new Duel();
    for (let i = 0; i < EPISODE_STROKES; i++) duel.step('player', 0);
    expect(duel.isDone('player')).toBe(true);
    const before = duel.history('player').states.length;
    duel.step('player', 0);
    expect(duel.history('player').states.length).toBe(before);
  });

  it('reset() restarts both histories from the initial state', () => {
    const duel = new Duel();
    duel.step('player', 0);
    duel.reset();
    expect(duel.history('player').states).toHaveLength(1);
    expect(duel.history('player').actions).toHaveLength(0);
  });
});
