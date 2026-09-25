// A pure helper for the HUD wind/current compass on the rl-paddler page. Kept separate from
// scene.ts (which pulls in three.js) so it's cheap to unit-test.

/** Rotation, in CSS degrees (clockwise, 0 = up), for a compass arrow that points along
 * `directionRad` (ama-flow's sim frame, CCW from +x), given that `viewUpRad` is the sim-frame
 * direction currently pointing "up" on screen -- see AmaFlowScene.viewUpAngleRad(), which
 * returns the focused boat's heading in chase view, or a fixed angle in top-down view.
 */
export function compassRotationDeg(directionRad: number, viewUpRad: number): number {
  const upX = Math.cos(viewUpRad);
  const upY = Math.sin(viewUpRad);
  const rightX = Math.sin(viewUpRad); // 90 deg clockwise from "up", in sim's CCW convention
  const rightY = -Math.cos(viewUpRad);
  const dx = Math.cos(directionRad);
  const dy = Math.sin(directionRad);
  const upComponent = dx * upX + dy * upY;
  const rightComponent = dx * rightX + dy * rightY;
  return (Math.atan2(rightComponent, upComponent) * 180) / Math.PI;
}
