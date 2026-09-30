import { describe, expect, it } from 'vitest';
import { classify, SIZE } from '../sketch-classifier';

// preprocess() and loadSession() need a browser (canvas, CDN, Cache Storage), so only the parts that
// run in plain Node are covered here.
describe('classify', () => {
  it('throws, rather than returning nothing, if the model session was never loaded', async () => {
    await expect(classify(new Float32Array(SIZE * SIZE), ['cat'], 1)).rejects.toThrow(/loadSession/);
  });
});
