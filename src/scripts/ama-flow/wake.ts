// A foam wake behind each canoe: a trail from the stern plus a thin V from the bow, laid down in
// the world as the boat moves and fading out over a few seconds. Open water has nothing else to
// pass by, and the camera follows the boat, so without this the canoe looks like it's standing
// still. Browser-only like scene.ts (three), but the shaping helpers are pure and unit-tested.
import * as THREE from 'three';
import { waveHeight, type WaveComponent } from '../../lib/ama-flow/waves';

const MAX_SAMPLES = 48; // trail points kept per boat (about 70 m at the spacing below)
const SAMPLE_SPACING_M = 1.5;
export const WAKE_LIFE_S = 9; // how long a patch of foam lasts
const BOW_X_M = 6.4; // distance of the bow/stern points from the hull's centre
const STERN_X_M = -6.4;
const SURFACE_LIFT_M = 0.3; // above the swell: the CPU wave height only approximates the shader's, so less would let the water cut holes in the foam

interface RibbonSpec {
  origin: number; // BOW_X_M or STERN_X_M
  side: -1 | 0 | 1; // which way the ribbon's centre line spreads from the hull's centre line
  alpha: number;
}

const RIBBONS: RibbonSpec[] = [
  { origin: STERN_X_M, side: 0, alpha: 0.4 }, // churn behind the stern
  { origin: BOW_X_M, side: -1, alpha: 0.45 }, // the bow wave's two arms
  { origin: BOW_X_M, side: 1, alpha: 0.45 },
];

/** How opaque foam of this age is, from 1 when fresh to 0 at WAKE_LIFE_S, easing out. */
export function wakeFade(ageS: number): number {
  const t = Math.min(Math.max(ageS / WAKE_LIFE_S, 0), 1);
  return (1 - t) ** 1.5;
}

/** Where one ribbon's centre line sits and how wide it is, at a given age: the stern churn
 * widens as it spreads, and the bow arms drift outward into a V.
 */
export function ribbonShape(side: -1 | 0 | 1, ageS: number): { centre: number; halfWidth: number } {
  if (side === 0) return { centre: 0, halfWidth: 0.35 + 0.15 * ageS };
  return { centre: side * (0.6 + 0.5 * ageS), halfWidth: 0.15 + 0.06 * ageS };
}

interface Sample {
  x: number; // hull centre, world x
  z: number;
  fwdX: number; // unit heading, world frame
  fwdZ: number;
  t: number; // when it was laid down, seconds
}

const VERTS_PER_RIBBON = (MAX_SAMPLES + 1) * 2;

export class Wake {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = []; // newest first
  private readonly positions = new Float32Array(RIBBONS.length * VERTS_PER_RIBBON * 3);
  private readonly colors = new Float32Array(RIBBONS.length * VERTS_PER_RIBBON * 4);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4)); // RGBA
    const indices: number[] = [];
    RIBBONS.forEach((_, r) => {
      for (let i = 0; i < MAX_SAMPLES; i++) {
        const a = (r * (MAX_SAMPLES + 1) + i) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false, // keep the foam white; the scene's tone mapping would dim it to grey
      }),
    );
    this.mesh.frustumCulled = false; // the bounds are never recomputed as the trail moves
  }

  /** Forget the trail, e.g. when a new race puts the boat back at the start. */
  clear(): void {
    this.samples.length = 0;
  }

  /** Lay down foam for the boat's current position (world x/z, heading psi) at time `nowS`, and
   * rebuild the ribbons. `current` is the water's velocity in the world frame: foam is carried by
   * it, so the trail drifts sideways in a cross-current instead of sitting on the boat's track.
   */
  update(
    x: number,
    z: number,
    psi: number,
    nowS: number,
    current: [number, number],
    waves: WaveComponent[],
  ): void {
    const live: Sample = { x, z, fwdX: Math.cos(psi), fwdZ: -Math.sin(psi), t: nowS };
    const newest = this.samples[0];
    if (!newest || Math.hypot(live.x - newest.x, live.z - newest.z) >= SAMPLE_SPACING_M) {
      this.samples.unshift(live);
    }
    while (this.samples.length > MAX_SAMPLES || (this.samples.length && nowS - this.samples[this.samples.length - 1].t > WAKE_LIFE_S)) {
      this.samples.pop();
    }

    const points = [live, ...this.samples]; // the live point keeps the trail attached to the hull
    RIBBONS.forEach((ribbon, r) => {
      let lastX = x;
      let lastY = 0;
      let lastZ = z;
      for (let i = 0; i <= MAX_SAMPLES; i++) {
        const v = (r * (MAX_SAMPLES + 1) + i) * 2;
        const p = points[i];
        const age = p ? nowS - p.t : 0;
        const fade = p ? wakeFade(age) : 0;
        if (p) {
          const { centre, halfWidth } = ribbonShape(ribbon.side, age);
          const baseX = p.x + p.fwdX * ribbon.origin + current[0] * age;
          const baseZ = p.z + p.fwdZ * ribbon.origin + current[1] * age;
          const latX = p.fwdZ; // perpendicular to the heading, in the water plane
          const latZ = -p.fwdX;
          const lx = baseX + latX * (centre + halfWidth);
          const lz = baseZ + latZ * (centre + halfWidth);
          const rx = baseX + latX * (centre - halfWidth);
          const rz = baseZ + latZ * (centre - halfWidth);
          this.setVertex(v, lx, waveHeight(waves, lx, lz, nowS) + SURFACE_LIFT_M, lz, ribbon.alpha * fade);
          this.setVertex(v + 1, rx, waveHeight(waves, rx, rz, nowS) + SURFACE_LIFT_M, rz, ribbon.alpha * fade);
          lastX = baseX;
          lastY = waveHeight(waves, baseX, baseZ, nowS) + SURFACE_LIFT_M;
          lastZ = baseZ;
        } else {
          // Past the end of the trail: collapse onto the last real point so it draws nothing.
          this.setVertex(v, lastX, lastY, lastZ, 0);
          this.setVertex(v + 1, lastX, lastY, lastZ, 0);
        }
      }
    });
    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  private setVertex(v: number, x: number, y: number, z: number, alpha: number): void {
    this.positions.set([x, y, z], v * 3);
    this.colors.set([1, 1, 1, alpha], v * 4);
  }
}
