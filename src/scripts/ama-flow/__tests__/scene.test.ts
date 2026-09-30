// scene.ts touches the DOM/WebGL, so only its pure helpers are unit-tested here; the rest is
// verified visually (see the PR description).
import { describe, expect, it } from 'vitest';
import { forwardStrokePose } from '../scene';

describe('forwardStrokePose', () => {
  it('keeps the blade in the water through the drive', () => {
    expect(forwardStrokePose(0).lift).toBe(0);
    expect(forwardStrokePose(0.3).lift).toBe(0);
    expect(forwardStrokePose(0.54).lift).toBe(0);
  });

  it('lifts the blade clear during recovery, peaking mid-recovery', () => {
    const early = forwardStrokePose(0.6).lift;
    const mid = forwardStrokePose(0.775).lift;
    const late = forwardStrokePose(0.95).lift;
    expect(early).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(early);
    expect(mid).toBeGreaterThan(late);
  });

  it('sweeps from the catch (-1) to the exit (+1) during the drive', () => {
    expect(forwardStrokePose(0).sweep).toBeCloseTo(-1);
    expect(forwardStrokePose(0.55).sweep).toBeCloseTo(1);
  });

  it('is continuous across the phase 1 -> 0 wrap', () => {
    const justBefore = forwardStrokePose(0.999);
    const wrapped = forwardStrokePose(1);
    expect(wrapped.sweep).toBeCloseTo(forwardStrokePose(0).sweep, 1);
    expect(justBefore.lift).toBeCloseTo(wrapped.lift, 1);
  });
});
