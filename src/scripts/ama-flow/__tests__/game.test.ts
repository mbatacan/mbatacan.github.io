import { describe, expect, it } from 'vitest';
import { COURSE_LENGTH_M, COURSE_WAYPOINTS, Duel, EPISODE_STROKES, policies, randomConditions } from '../game';

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

  it('targets the first waypoint until captured, then the next', () => {
    const duel = new Duel();
    expect(duel.currentWaypoint('player')).toEqual(COURSE_WAYPOINTS[0]);
    // Run the model (which should navigate toward the buoy) until either it's captured or the
    // episode ends -- whichever happens first, this shouldn't throw or hang.
    while (!duel.isDone('player') && duel.history('player').waypointIndex === 0) {
      duel.step('player', policies.model(duel.observation('player')));
    }
    if (!duel.isDone('player')) {
      expect(duel.currentWaypoint('player')).toEqual(COURSE_WAYPOINTS[1]);
    }
  });

  it('distanceMadeGoodM accumulates completed-leg length plus progress along the current leg', () => {
    const duel = new Duel();
    expect(duel.distanceMadeGoodM('player')).toBe(0);
    for (let i = 0; i < 20; i++) duel.step('player', policies.model(duel.observation('player')));
    const progress = duel.distanceMadeGoodM('player');
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(COURSE_LENGTH_M);
  });
});

describe('randomConditions', () => {
  it('is deterministic for a given seed', () => {
    expect(randomConditions(42)).toEqual(randomConditions(42));
  });

  it('spans a wide range of directions across seeds', () => {
    const directions = Array.from({ length: 50 }, (_, i) => randomConditions(i).wind_direction_rad);
    expect(Math.min(...directions)).toBeLessThan(-Math.PI / 2);
    expect(Math.max(...directions)).toBeGreaterThan(Math.PI / 2);
  });
});
