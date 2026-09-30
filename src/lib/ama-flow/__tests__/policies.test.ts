import { describe, expect, it } from 'vitest';
import indexData from '../../../data/ama-flow/policies/index.json';
import { DEFAULT_POLICY_ID, POLICY_ENTRIES, policyAction } from '../policy';

describe('published policy entries', () => {
  it('lists every id in index.json, in order, with the default among them', () => {
    expect(POLICY_ENTRIES.map((entry) => entry.meta.id)).toEqual(indexData.order);
    expect(indexData.order).toContain(DEFAULT_POLICY_ID);
  });

  for (const entry of POLICY_ENTRIES) {
    it(`${entry.meta.id} has every meta field the page renders`, () => {
      const { meta } = entry;
      expect(meta.label).toBeTruthy();
      expect(meta.note).toBeTruthy();
      expect(meta.run_id).toBeTruthy();
      expect(meta.step).toBeGreaterThan(0);
      expect(Object.keys(meta.params).length).toBeGreaterThan(0);
      expect(meta.params.seed).toBeDefined();
      expect(meta.eval_grid.data).toHaveLength(9);
      expect(meta.eval_grid.data[0]).toHaveLength(meta.eval_grid.columns.length);
      expect(Object.keys(meta.curve).length).toBeGreaterThan(0);
      for (const points of Object.values(meta.curve)) {
        expect(points.length).toBeGreaterThan(0);
        expect(points.every(([step]) => step <= meta.step)).toBe(true);
      }
    });
  }

  it('policyAction throws on an unknown id instead of falling back', () => {
    expect(() => policyAction(new Array(18).fill(0), 'nope')).toThrow(/unknown policy "nope"/);
  });
});
