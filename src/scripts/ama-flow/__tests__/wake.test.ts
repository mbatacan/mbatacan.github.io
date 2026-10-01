import { describe, expect, it } from 'vitest';
import { defaultSwell } from '../../../lib/ama-flow/waves';
import { ribbonShape, Wake, wakeFade, WAKE_LIFE_S } from '../wake';

describe('wakeFade', () => {
  it('is fully opaque when fresh, gone after its life, and never rises', () => {
    expect(wakeFade(0)).toBe(1);
    expect(wakeFade(WAKE_LIFE_S)).toBe(0);
    expect(wakeFade(WAKE_LIFE_S * 3)).toBe(0);
    const samples = [0, 1, 2, 4, 6, 8].map(wakeFade);
    samples.slice(1).forEach((value, i) => expect(value).toBeLessThan(samples[i]));
  });
});

describe('ribbonShape', () => {
  it('keeps the stern churn on the centre line and widens it with age', () => {
    expect(ribbonShape(0, 0).centre).toBe(0);
    expect(ribbonShape(0, 5).halfWidth).toBeGreaterThan(ribbonShape(0, 0).halfWidth);
  });

  it('spreads the bow arms apart as they age, one to each side', () => {
    const port = ribbonShape(-1, 4).centre;
    const starboard = ribbonShape(1, 4).centre;
    expect(port).toBeLessThan(0);
    expect(starboard).toBeGreaterThan(0);
    expect(Math.abs(ribbonShape(1, 6).centre)).toBeGreaterThan(Math.abs(ribbonShape(1, 1).centre));
  });
});

describe('Wake', () => {
  const waves = defaultSwell(0);

  // With no trail yet, the hull's own point and its first sample are the only foam: 2 points x 3
  // ribbons x 2 vertices.
  const HULL_ONLY_VERTICES = 12;

  /** How many vertices currently have any opacity. */
  const visibleVertices = (wake: Wake) => {
    const colors = wake.mesh.geometry.attributes.color.array as Float32Array;
    let count = 0;
    for (let i = 3; i < colors.length; i += 4) if (colors[i] > 0) count++;
    return count;
  };

  it('lays down a trail as the boat moves and drops it after the foam has faded', () => {
    const wake = new Wake();
    for (let t = 0; t < 10; t += 0.1) wake.update(t * 3, 0, 0, t, [0, 0], waves);
    expect(visibleVertices(wake)).toBeGreaterThan(20);
    for (let t = 10; t < 30; t += 0.5) wake.update(30, 0, 0, t, [0, 0], waves);
    expect(visibleVertices(wake)).toBeLessThanOrEqual(HULL_ONLY_VERTICES);
  });

  it('clears the trail', () => {
    const wake = new Wake();
    for (let t = 0; t < 5; t += 0.1) wake.update(t * 3, 0, 0, t, [0, 0], waves);
    wake.clear();
    wake.update(0, 0, 0, 5, [0, 0], waves);
    expect(visibleVertices(wake)).toBeLessThanOrEqual(HULL_ONLY_VERTICES);
  });
});
