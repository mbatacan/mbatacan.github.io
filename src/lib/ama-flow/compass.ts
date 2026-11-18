// Pure helpers for the HUD's wind/current bearings on the rl-paddler page. Kept separate from
// scene.ts (which pulls in three.js) so it's cheap to unit-test.

/** Rotation, in CSS degrees (clockwise, 0 = up), for a compass arrow that points along
 * `directionRad` (ama-flow's sim frame, CCW from +x), given that `viewUpRad` is the sim-frame
 * direction currently pointing "up" on screen (the boat's heading, for a boat-relative bearing).
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

const SECTORS = [
  'ahead',
  'starboard bow',
  'starboard beam',
  'starboard quarter',
  'astern',
  'port quarter',
  'port beam',
  'port bow',
] as const;

/** The boat-relative name for a bearing in degrees clockwise from the bow (what
 * compassRotationDeg returns when view-up is the boat's heading), for the HUD's sea panel.
 */
export function bearingSector(bearingDeg: number): (typeof SECTORS)[number] {
  return SECTORS[((Math.round(bearingDeg / 45) % 8) + 8) % 8];
}
