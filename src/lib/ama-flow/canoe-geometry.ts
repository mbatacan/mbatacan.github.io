// Body-frame OC6 glyph geometry, mirroring ama_flow/viz/canoe.py's canoe_outlines() (a to-scale
// sketch used for both ama-flow's own matplotlib/pygame views and this 3D scene). These
// dimensions are cosmetic constants, not physics inputs, so they're kept here directly rather
// than round-tripped through the JSON export.
export const HULL_LENGTH_M = 13.4;
export const HULL_BEAM_M = 0.6;
export const AMA_LENGTH_M = 4.0;
export const AMA_BEAM_M = 0.25;
export const AMA_OFFSET_M = 1.2; // lateral distance from the centreline to the ama's centreline
export const IAKO_WIDTH_M = 0.08;

export type Point2 = [number, number];

/** A narrow, bow-heavy lens shape centred at the origin, pointing along +x (forward). */
function hullOutline(length: number, beam: number): Point2[] {
  const halfLen = length / 2;
  return [
    [halfLen, 0],
    [halfLen * 0.3, beam / 2],
    [-halfLen * 0.8, beam / 2],
    [-halfLen, 0],
    [-halfLen * 0.8, -beam / 2],
    [halfLen * 0.3, -beam / 2],
  ];
}

export interface CanoeOutlines {
  hull: Point2[];
  ama: Point2[]; // offset to +y (port)
  forwardIako: Point2[];
  aftIako: Point2[];
}

export function canoeOutlines(): CanoeOutlines {
  const iakoHalf = IAKO_WIDTH_M / 2;
  const fwdX = HULL_LENGTH_M * 0.25;
  const aftX = -HULL_LENGTH_M * 0.25;

  function iakoPts(cx: number): Point2[] {
    return [
      [cx - iakoHalf, 0],
      [cx + iakoHalf, 0],
      [cx + iakoHalf, AMA_OFFSET_M],
      [cx - iakoHalf, AMA_OFFSET_M],
    ];
  }

  return {
    hull: hullOutline(HULL_LENGTH_M, HULL_BEAM_M),
    ama: hullOutline(AMA_LENGTH_M, AMA_BEAM_M).map(([x, y]) => [x, y + AMA_OFFSET_M]),
    forwardIako: iakoPts(fwdX),
    aftIako: iakoPts(aftX),
  };
}
