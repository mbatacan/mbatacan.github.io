import { describe, expect, it } from 'vitest';
import { compassRotationDeg } from '../compass';

describe('compassRotationDeg', () => {
  it('points straight up when the direction matches view-up', () => {
    expect(compassRotationDeg(0, 0)).toBeCloseTo(0);
    expect(compassRotationDeg(1.2, 1.2)).toBeCloseTo(0);
  });

  it('points left for a port (sim +y) direction seen from a +x heading', () => {
    // Matches the plan's worked example: wind_direction_rad = pi/2 (sim +y, port), viewed with
    // the boat heading +x (viewUpRad = 0) -- renders at -90 deg (counter-clockwise, i.e. left).
    expect(compassRotationDeg(Math.PI / 2, 0)).toBeCloseTo(-90);
  });

  it('points right for a starboard (sim -y) direction seen from a +x heading', () => {
    expect(compassRotationDeg(-Math.PI / 2, 0)).toBeCloseTo(90);
  });

  it('is invariant to a shared rotation of both direction and view-up', () => {
    const a = compassRotationDeg(0.4, -0.2);
    const b = compassRotationDeg(0.4 + 1.0, -0.2 + 1.0);
    expect(b).toBeCloseTo(a);
  });
});
