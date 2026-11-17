import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PACKED_ALPHA_FLOOR,
  PACKED_ALPHA_RANGE,
  normalizePackedAlpha,
  packedAlphaRendererFor,
} from "../packed-alpha-renderer.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A WebGL context stand-in that records every call; constants are numbers. */
function fakeWebGL() {
  const calls = [];
  const results = { getShaderParameter: true, getProgramParameter: true, isContextLost: false };
  const gl = new Proxy({}, {
    get(_, name) {
      if (typeof name !== "string") return undefined;
      if (/^[A-Z_0-9]+$/.test(name)) return name.length; // GL enum
      return (...args) => {
        calls.push([name, ...args]);
        return name in results ? results[name] : {};
      };
    },
  });
  return { gl, calls };
}

function fakeCanvas({ webgl = null, ctx2d = null } = {}) {
  return {
    width: 480,
    height: 480,
    contexts: [],
    getContext(type) {
      this.contexts.push(type);
      if (type === "webgl") return webgl;
      if (type === "2d") return ctx2d;
      return null;
    },
    addEventListener() {},
  };
}

const decodedVideo = { readyState: 4, videoWidth: 480, videoHeight: 960 };

test("normalizePackedAlpha maps the measured mask range 40..190 onto 0..255, clamped", () => {
  assert.equal(normalizePackedAlpha(0), 0);
  assert.equal(normalizePackedAlpha(PACKED_ALPHA_FLOOR), 0);
  assert.equal(normalizePackedAlpha(PACKED_ALPHA_FLOOR + PACKED_ALPHA_RANGE), 255);
  assert.equal(normalizePackedAlpha(255), 255);
  assert.equal(normalizePackedAlpha(115), 127.5);
});

test("the GPU compositor uploads the frame and draws it with no CPU pixel readback", () => {
  globalThis.WebGLRenderingContext ??= class {};
  const { gl, calls } = fakeWebGL();
  const canvas = fakeCanvas({ webgl: gl });
  const renderer = packedAlphaRendererFor(canvas);

  assert.equal(renderer.gpu, true);
  assert.equal(renderer.draw(decodedVideo, 1.3), true);
  const names = calls.map(([name]) => name);
  assert.ok(names.includes("texImage2D"));
  assert.ok(names.includes("drawArrays"));
  assert.ok(!names.includes("readPixels"));
  assert.deepEqual(calls.filter(([name]) => name === "uniform1f").map(([, , value]) => value), [0.5 / 960, 1.3]);
  // Same alpha math as the CPU fallback (normalizePackedAlpha), in the shader.
  const shaderSource = calls.filter(([name]) => name === "shaderSource").map(([, , source]) => source).join("\n");
  assert.match(shaderSource, new RegExp(`mask \\* 255\\.0 - ${PACKED_ALPHA_FLOOR}\\.0\\) / ${PACKED_ALPHA_RANGE}\\.0`));
  assert.deepEqual(canvas.contexts, ["webgl"]);
});

test("one compositor per canvas, and no frame is drawn before the video has decoded one", () => {
  globalThis.WebGLRenderingContext ??= class {};
  const { gl, calls } = fakeWebGL();
  const canvas = fakeCanvas({ webgl: gl });
  assert.equal(packedAlphaRendererFor(canvas), packedAlphaRendererFor(canvas));
  assert.equal(packedAlphaRendererFor(null), null);
  const before = calls.length;
  assert.equal(packedAlphaRendererFor(canvas).draw({ readyState: 1, videoWidth: 0, videoHeight: 0 }), false);
  assert.equal(calls.length, before);
});

test("without WebGL the canvas falls back to the 2D compositor with the same alpha math", () => {
  // One pixel: the color half, then the mask half (its luminance in every channel).
  const colorFrame = { data: Uint8ClampedArray.from([10, 20, 30, 255]) };
  const maskFrame = { data: Uint8ClampedArray.from([190, 190, 190, 255]) };
  const ctx2d = {
    drawImage() {},
    getImageData: () => colorFrame,
    putImageData(image) { this.painted = image; },
  };
  const scratchCtx = { drawImage() {}, getImageData: () => maskFrame };
  globalThis.document = { createElement: () => ({ getContext: () => scratchCtx }) };
  try {
    const canvas = fakeCanvas({ webgl: null, ctx2d });
    const renderer = packedAlphaRendererFor(canvas);
    assert.equal(renderer.gpu, false);
    assert.equal(renderer.draw(decodedVideo), true);
    assert.equal(ctx2d.painted.data[3], normalizePackedAlpha(190));
    assert.deepEqual(canvas.contexts, ["webgl", "2d"]);
  } finally {
    delete globalThis.document;
  }
});

test("GalaxyEnvironment composites through the renderer, never reading pixels back on the main thread", () => {
  const source = fs.readFileSync(path.join(here, "..", "GalaxyEnvironment.js"), "utf8");
  assert.match(source, /packedAlphaRendererFor\(canvas\)\?\.draw\(video, brightness\)/);
  assert.doesNotMatch(source, /\.getImageData\(|\.putImageData\(/);
});
