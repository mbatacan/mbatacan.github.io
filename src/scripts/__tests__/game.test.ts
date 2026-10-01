import { afterEach, describe, expect, it, vi } from 'vitest';
import labels from '../../data/quickdraw-labels.json';
import { GAME_CLASSES } from '../../data/quickdraw-game-classes';
import { checkWin, pickTarget } from '../game';

afterEach(() => vi.restoreAllMocks());

describe('GAME_CLASSES', () => {
  it('only contains labels the model can actually output', () => {
    const known = new Set(labels);
    expect(GAME_CLASSES.filter((c) => !known.has(c))).toEqual([]);
  });

  it('has no duplicates', () => {
    expect(new Set(GAME_CLASSES).size).toBe(GAME_CLASSES.length);
  });
});

describe('pickTarget', () => {
  it('returns one of the game classes', () => {
    for (let i = 0; i < 50; i++) expect(GAME_CLASSES).toContain(pickTarget());
  });

  it('never repeats the excluded target, even when the RNG would pick it', () => {
    const excluded = GAME_CLASSES[0];
    vi.spyOn(Math, 'random').mockReturnValue(0); // would pick index 0 without the exclusion
    expect(pickTarget(excluded)).not.toBe(excluded);
  });

  it('can reach every other class when one is excluded', () => {
    const excluded = GAME_CLASSES[0];
    const pool = GAME_CLASSES.filter((c) => c !== excluded);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(pickTarget(excluded)).toBe(pool[pool.length - 1]);
  });
});

describe('checkWin', () => {
  const predictions = [
    { label: 'cat', prob: 0.6 },
    { label: 'dog', prob: 0.3 },
  ];

  it('wins when the top prediction is the target', () => {
    expect(checkWin(predictions, 'cat')).toBe(true);
  });

  it('does not win when the target is only a lower-ranked prediction', () => {
    expect(checkWin(predictions, 'dog')).toBe(false);
  });

  it('does not win on an empty prediction list', () => {
    expect(checkWin([], 'cat')).toBe(false);
  });
});
