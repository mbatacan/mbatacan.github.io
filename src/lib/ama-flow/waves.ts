// A cosmetic ocean swell field: a small sum of traveling sine waves, sampled both on the CPU
// (to heave/pitch/roll the boats) and in the ocean mesh's vertex shader (scene.ts duplicates
// this formula in GLSL -- there's no way to share code between the two).
//
// This is visual only and never feeds the physics -- see ama-flow's #20 for actual wave
// *physics* (a future, separate game mode once that's designed and the agent is retrained on
// it). A true Gerstner wave also displaces vertices horizontally to sharpen crests; this v1
// skips that and only displaces height, which is simpler to keep the shader and this CPU copy
// in exact agreement and still reads fine as open-water chop.
export interface WaveComponent {
  amplitude: number; // m
  wavenumber: number; // rad/m, k = 2*pi / wavelength
  angularSpeed: number; // rad/s
  direction: [number, number]; // unit vector, world x/y
}

/** Three swell components loosely aligned with the wind, with enough spread in wavelength and
 * direction to avoid a visibly repeating pattern.
 */
export function defaultSwell(windDirectionRad: number): WaveComponent[] {
  const spreads = [0, 0.6, -0.9];
  const wavelengths = [22, 11, 6];
  const amplitudes = [0.35, 0.18, 0.08];
  const speeds = [1.1, 1.6, 2.1];
  return spreads.map((spread, i) => {
    const dir = windDirectionRad + spread;
    return {
      amplitude: amplitudes[i],
      wavenumber: (2 * Math.PI) / wavelengths[i],
      angularSpeed: speeds[i],
      direction: [Math.cos(dir), Math.sin(dir)],
    };
  });
}

export function waveHeight(components: WaveComponent[], x: number, z: number, t: number): number {
  let h = 0;
  for (const c of components) {
    const phase = c.wavenumber * (c.direction[0] * x + c.direction[1] * z) - c.angularSpeed * t;
    h += c.amplitude * Math.sin(phase);
  }
  return h;
}

/** Analytic surface slope [dHeight/dx, dHeight/dz], for tilting a boat to match the water. */
export function waveSlope(
  components: WaveComponent[],
  x: number,
  z: number,
  t: number,
): [number, number] {
  let dx = 0;
  let dz = 0;
  for (const c of components) {
    const phase = c.wavenumber * (c.direction[0] * x + c.direction[1] * z) - c.angularSpeed * t;
    const slope = c.amplitude * c.wavenumber * Math.cos(phase);
    dx += slope * c.direction[0];
    dz += slope * c.direction[1];
  }
  return [dx, dz];
}
