// scene.ts touches the DOM/WebGL, so only its pure helpers are unit-tested here; the rest is
// verified visually (see the PR description).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLADE_CENTER_OFFSET_M, forwardStrokePose, paddlePose } from '../scene';

describe('forwardStrokePose', () => {
  it('keeps the blade in the water through the drive', () => {
    expect(forwardStrokePose(0).lift).toBe(0);
    expect(forwardStrokePose(0.2).lift).toBe(0);
    expect(forwardStrokePose(0.39).lift).toBe(0);
  });

  it('lifts the blade clear during recovery, peaking mid-recovery', () => {
    const early = forwardStrokePose(0.45).lift;
    const mid = forwardStrokePose(0.7).lift;
    const late = forwardStrokePose(0.95).lift;
    expect(early).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(early);
    expect(mid).toBeGreaterThan(late);
  });

  it('pulls for less of the cycle than it recovers', () => {
    // Drive is sweep going -1 -> +1; find where recovery (lift > 0) starts.
    const firstLifted = [...Array(100).keys()].find((i) => forwardStrokePose(i / 100).lift > 0);
    expect(firstLifted).toBeLessThan(50);
  });

  it('sweeps from the catch (-1) to the exit (+1) during the drive', () => {
    expect(forwardStrokePose(0).sweep).toBeCloseTo(-1);
    expect(forwardStrokePose(0.4).sweep).toBeCloseTo(1);
  });

  it('is continuous across the phase 1 -> 0 wrap', () => {
    const justBefore = forwardStrokePose(0.999);
    const wrapped = forwardStrokePose(1);
    expect(wrapped.sweep).toBeCloseTo(forwardStrokePose(0).sweep, 1);
    expect(justBefore.lift).toBeCloseTo(wrapped.lift, 1);
  });
});

/** Where the blade's center is, in the figure frame, for a pose. */
function bladeCenter(pose: ReturnType<typeof paddlePose>): THREE.Vector3 {
  return new THREE.Vector3(0, BLADE_CENTER_OFFSET_M, 0).applyEuler(pose.rotation).add(pose.position);
}

describe('paddlePose', () => {
  const catchPose = paddlePose(1, -1, 0);
  const exitPose = paddlePose(1, 1, 0);

  it('reaches forward at the catch and finishes behind the paddler at the exit', () => {
    expect(bladeCenter(catchPose).x).toBeGreaterThan(0.8);
    expect(bladeCenter(exitPose).x).toBeLessThan(-0.4);
  });

  it('leans the torso forward into the catch and upright at the exit', () => {
    expect(catchPose.torsoPitch).toBeGreaterThan(0.3);
    expect(exitPose.torsoPitch).toBeLessThan(0.05);
  });

  it('keeps the blade at a constant depth throughout the drive', () => {
    const depths = [-1, -0.5, 0, 0.5, 1].map((sweep) => bladeCenter(paddlePose(0, sweep, 0)).y);
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThan(1e-6);
  });

  it('lifts the blade well clear of the water at full lift', () => {
    const planted = bladeCenter(paddlePose(0, 0, 0)).y;
    const lifted = bladeCenter(paddlePose(0, 0, 1)).y;
    expect(lifted - planted).toBeGreaterThan(0.3);
  });

  it('puts the blade outboard of the top hand on both sides', () => {
    const topOf = (pose: ReturnType<typeof paddlePose>) =>
      new THREE.Vector3(0, 0.7, 0).applyEuler(pose.rotation).add(pose.position);
    const port = paddlePose(0, 0, 0);
    const starboard = paddlePose(1, 0, 0);
    expect(bladeCenter(port).z).toBeLessThan(topOf(port).z);
    expect(bladeCenter(port).z).toBeLessThan(0);
    expect(bladeCenter(starboard).z).toBeGreaterThan(topOf(starboard).z);
    expect(bladeCenter(starboard).z).toBeGreaterThan(0);
  });

  it('keeps the top of the shaft on the hand, which rides forward with the lean', () => {
    const handX = (pose: ReturnType<typeof paddlePose>) =>
      new THREE.Vector3(0, 0.7, 0).applyEuler(pose.rotation).add(pose.position).x;
    expect(handX(catchPose)).toBeGreaterThan(handX(exitPose));
  });
});
