import { describe, expect, it } from 'vitest';
import { AMA_OFFSET_M, canoeOutlines, HULL_BEAM_M, type Point2 } from '../canoe-geometry';

const xs = (points: Point2[]) => points.map(([x]) => x);
const ys = (points: Point2[]) => points.map(([, y]) => y);

describe('canoeOutlines', () => {
  const { hull, ama, forwardIako, aftIako } = canoeOutlines();
  const amaX = [Math.min(...xs(ama)), Math.max(...xs(ama))];
  const amaY = [Math.min(...ys(ama)), Math.max(...ys(ama))];

  it('lands both iako within the ama\'s length, so the float is actually attached', () => {
    for (const iako of [forwardIako, aftIako]) {
      expect(Math.min(...xs(iako))).toBeGreaterThan(amaX[0]);
      expect(Math.max(...xs(iako))).toBeLessThan(amaX[1]);
    }
  });

  it('runs each iako from the hull out to the ama, across the ama\'s width', () => {
    for (const iako of [forwardIako, aftIako]) {
      expect(Math.min(...ys(iako))).toBeLessThanOrEqual(HULL_BEAM_M / 2);
      expect(Math.max(...ys(iako))).toBeGreaterThanOrEqual(amaY[0]);
      expect(Math.max(...ys(iako))).toBeLessThanOrEqual(amaY[1]);
      expect(Math.max(...ys(iako))).toBeCloseTo(AMA_OFFSET_M);
    }
  });

  it('keeps the two iako apart from each other, forward one ahead', () => {
    expect(Math.min(...xs(forwardIako))).toBeGreaterThan(Math.max(...xs(aftIako)));
  });

  it('centres the hull on the origin and puts the ama to port (+y)', () => {
    expect(Math.min(...ys(hull))).toBeCloseTo(-HULL_BEAM_M / 2);
    expect(amaY[0]).toBeGreaterThan(0);
  });
});
