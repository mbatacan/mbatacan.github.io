import { describe, expect, it } from 'vitest';
import { defaultSwell } from '../waves';

describe('defaultSwell', () => {
  it('travels toward three.js -z for a sim +y (port) wind -- regression test for a direction bug', () => {
    // sim wind_direction_rad = pi/2 means the wind (and swell) travels toward sim +y, which is
    // three.js -z (setBoatState's threeZ = -y convention). Getting this backwards made the
    // swell travel opposite the wind.
    const [primary] = defaultSwell(Math.PI / 2);
    expect(primary.direction[0]).toBeCloseTo(0); // no x component
    expect(primary.direction[1]).toBeCloseTo(-1); // three -z, not +z
  });

  it('travels toward three.js +x for a sim +x wind', () => {
    const [primary] = defaultSwell(0);
    expect(primary.direction[0]).toBeCloseTo(1);
    expect(primary.direction[1]).toBeCloseTo(0);
  });
});
