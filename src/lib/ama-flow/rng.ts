// A small seeded PRNG for the game's crew-force noise (ama_flow.physics.strokes.crew_force
// needs a uniform(low, high) draw per seat, per stroke). Doesn't need to match numpy's PCG64 --
// crewForce's parity contract is the *formula*, not the RNG stream (see ama-flow's
// export/web.py). mulberry32 is a standard, fast, seedable 32-bit generator.
import type { Rng } from './physics';

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    uniform(low: number, high: number): number {
      return low + next() * (high - low);
    },
  };
}
