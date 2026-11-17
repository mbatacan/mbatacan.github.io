// Body-frame OC6 glyph geometry, based on ama_flow/viz/canoe.py's canoe_outlines() (a to-scale
// sketch used for ama-flow's own matplotlib/pygame views and this 3D scene). These dimensions are
// cosmetic constants, not physics inputs, so they're kept here directly rather than round-tripped
// through the JSON export. One deliberate difference: ama-flow puts the two iako at +-0.25 of the
// hull length (+-3.35 m), past the ends of its 4 m ama (+-2 m), so the float looks unattached in 3D.
// Here they land on the ama instead (see IAKO_SPACING_FRACTION).
export const HULL_LENGTH_M = 13.4;
export const HULL_BEAM_M = 0.6;
export const AMA_LENGTH_M = 4.0;
export const AMA_BEAM_M = 0.25;
export const AMA_OFFSET_M = 1.2; // lateral distance from the centreline to the ama's centreline
// Each iako's x, as a fraction of the ama's length from its centre: 0.4 puts them 3.2 m apart,
// the 10 ft 7 in spreader centres of a Hawaiian-spec OC6 (Clipper Advantage).
export const IAKO_SPACING_FRACTION = 0.4;
