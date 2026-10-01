// Runs VinayHajare/quickdraw-mobilevit-small-onnx (MIT) entirely in the browser via onnxruntime-web.
// The runtime and model weights are loaded from CDN/Hugging Face at runtime rather than bundled, so the
// wasm binaries never need to pass through Vite's asset pipeline. Preprocessing and inference follow the
// approach verified in https://github.com/PaulKinlan/web-ai-showcase (quickdraw-sketch-recognition).

export const SIZE = 28;

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.wasm.min.mjs";
const ORT_WASM_DIR = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
const MODEL_URL =
  "https://huggingface.co/VinayHajare/quickdraw-mobilevit-small-onnx/resolve/main/model.onnx";
const CACHE_NAME = "quickdraw-onnx-cache-v1";

export interface Prediction {
  label: string;
  prob: number;
}

// onnxruntime-web is imported from a CDN URL at runtime, so it has no static types.
let ortModule: any = null;
let session: any = null;
let loadingPromise: Promise<any> | null = null;

/** Download the model, serving it from Cache Storage on repeat visits instead of re-fetching. */
async function fetchCachedModel(
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(MODEL_URL);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download model (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  await cache.put(MODEL_URL, new Response(buf, { headers: { "content-length": String(received) } }));
  return buf;
}

/**
 * Load onnxruntime-web and the QuickDraw model. Safe to call more than once — the first call's
 * in-flight promise is reused, and the resulting session is cached for classify().
 */
export function loadSession(onProgress?: (loaded: number, total: number) => void): Promise<any> {
  if (!loadingPromise) {
    loadingPromise = (async () => {
      ortModule = await import(/* @vite-ignore */ ORT_URL);
      ortModule.env.wasm.wasmPaths = ORT_WASM_DIR;
      ortModule.env.wasm.numThreads = 1;
      const bytes = await fetchCachedModel(onProgress);
      session = await ortModule.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
      return session;
    })();
  }
  return loadingPromise;
}

/**
 * Tight-crop a drawing canvas (white ink on black) to its ink bounding box, center it, and
 * downscale to a 28x28 grayscale Float32Array in [0,1] — matching how QuickDraw sketches are
 * normalized, regardless of where or how large the user actually drew. Returns null if the
 * canvas has no ink.
 */
export function preprocess(canvas: HTMLCanvasElement): Float32Array | null {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const px = ctx.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const side = Math.max(bw, bh);
  const pad = Math.round(side * 0.18);
  const box = side + pad * 2;

  const off = document.createElement("canvas");
  off.width = SIZE;
  off.height = SIZE;
  const octx = off.getContext("2d");
  if (!octx) throw new Error("Canvas 2D context unavailable");
  octx.fillStyle = "black";
  octx.fillRect(0, 0, SIZE, SIZE);
  octx.imageSmoothingEnabled = true;
  const scale = SIZE / box;
  const dx = (box - bw) / 2;
  const dy = (box - bh) / 2;
  octx.drawImage(canvas, minX, minY, bw, bh, dx * scale, dy * scale, bw * scale, bh * scale);

  const im = octx.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i] = (im[i * 4] * 0.299 + im[i * 4 + 1] * 0.587 + im[i * 4 + 2] * 0.114) / 255;
  }
  return out;
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

/** Run inference on a preprocessed 28x28 grayscale sketch, returning the top-K predicted labels. */
export async function classify(
  gray: Float32Array,
  labels: string[],
  topK = 5,
): Promise<Prediction[]> {
  if (!session || !ortModule) {
    throw new Error("Model session not loaded — call loadSession() first.");
  }
  const tensor = new ortModule.Tensor("float32", gray, [1, 1, SIZE, SIZE]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const probs = softmax(out[session.outputNames[0]].data as Float32Array);
  const order = [...probs.keys()].sort((a, b) => probs[b] - probs[a]).slice(0, topK);
  return order.map((i) => ({ label: labels[i], prob: probs[i] }));
}
