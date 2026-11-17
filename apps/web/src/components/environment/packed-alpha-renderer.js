/**
 * Composites a packed-alpha video frame (real color on the top half, its
 * matted alpha mask as grayscale on the bottom half -- see the header comment
 * in GalaxyEnvironment.js) onto a visible canvas.
 *
 * GPU path (WebGL): the decoded frame is uploaded as a texture and a single
 * fragment shader takes color from the top half and alpha from the bottom
 * half. No pixels are read back to the CPU and no per-pixel JavaScript runs,
 * so compositing costs the page's main thread -- which it shares with
 * playback, input and React -- almost nothing. The previous approach
 * (drawImage + two getImageData readbacks + a per-pixel loop + putImageData
 * per object per frame) measured 63% of the main thread on Android, starving
 * audio start-up of the turns it needs.
 *
 * 2D path: that original approach, kept only for browsers without WebGL.
 *
 * Both paths apply the same alpha normalisation (normalizePackedAlpha) and
 * brightness multiplier, so the composited result is the same either way.
 */

// The packed alpha mask never decodes as a true 0..255. Measured in a real
// browser: background floors at 14-33 (not 0) and an object's own disk tops
// out at 196-237 (not 255) -- limited/TV-range H.264 signalling, plus, on the
// moon, its own lit/unlit alpha split (196 vs 223). Copied straight across,
// that left every "solid" object only 77-93% opaque, which is why the
// star-background layer visibly showed through the moon. Normalising 40..190
// to a full 0..255 clamps background to truly invisible and the disk to truly
// opaque; the narrow band between still carries the anti-aliased rim, so
// edges stay smooth.
export const PACKED_ALPHA_FLOOR = 40;
export const PACKED_ALPHA_RANGE = 150;

/** Composited alpha (0..255) for a packed mask sample (0..255). */
export function normalizePackedAlpha(sample) {
  const a = ((sample - PACKED_ALPHA_FLOOR) * 255) / PACKED_ALPHA_RANGE;
  return a < 0 ? 0 : a > 255 ? 255 : a;
}

/** True once `video` has a decoded frame of known size. */
function hasFrame(video) {
  return Boolean(video && video.readyState >= 2 && video.videoWidth && video.videoHeight);
}

// A canvas holds one kind of context for life, so it has exactly one compositor.
const renderers = new WeakMap();

/**
 * The compositor for `canvas`: `{ gpu, draw(video, brightness = 1) }`, or
 * null without a canvas. `draw` returns whether a frame was painted.
 */
export function packedAlphaRendererFor(canvas) {
  if (!canvas) return null;
  if (!renderers.has(canvas)) {
    renderers.set(canvas, createWebGLRenderer(canvas) || create2DRenderer(canvas));
  }
  return renderers.get(canvas);
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  // Clip-space quad -> canvas coordinates, y down (texture row 0 is the
  // video's top row, since UNPACK_FLIP_Y_WEBGL stays false).
  v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_frame;
uniform float u_halfTexel;
uniform float u_brightness;
varying vec2 v_uv;
void main() {
  // Each half is clamped half a texel short of the seam, so filtering never
  // blends color with mask (drawImage's source rectangle has the same bound).
  float y = v_uv.y * 0.5;
  vec3 color = texture2D(u_frame, vec2(v_uv.x, min(y, 0.5 - u_halfTexel))).rgb;
  float mask = texture2D(u_frame, vec2(v_uv.x, max(0.5 + y, 0.5 + u_halfTexel))).r;
  float alpha = clamp((mask * 255.0 - ${PACKED_ALPHA_FLOOR.toFixed(1)}) / ${PACKED_ALPHA_RANGE.toFixed(1)}, 0.0, 1.0);
  color = min(color * u_brightness, vec3(1.0));
  gl_FragColor = vec4(color * alpha, alpha); // premultiplied, as the canvas expects
}
`;

function createWebGLRenderer(canvas) {
  if (typeof WebGLRenderingContext === "undefined") return null;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  let state = setUp(gl);
  if (!state) return null;

  // A lost context (GPU reset, memory pressure, backgrounding) skips frames
  // until the browser restores it; the canvas then keeps its last frame.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    state = null;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    state = setUp(gl);
  });

  return {
    gpu: true,
    draw(video, brightness = 1) {
      if (!state || !hasFrame(video)) return false;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, state.texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch {
        return false; // e.g. a frame the browser refuses to upload; the next tick retries
      }
      gl.uniform1f(state.halfTexel, 0.5 / video.videoHeight);
      gl.uniform1f(state.brightness, brightness || 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
  };
}

function setUp(gl) {
  const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  if (!program) return null;
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Video frames are rarely power-of-two sized: WebGL 1 requires clamping and no mipmaps.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);

  return {
    texture,
    halfTexel: gl.getUniformLocation(program, "u_halfTexel"),
    brightness: gl.getUniformLocation(program, "u_brightness"),
  };
}

function linkProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

// Scratch canvas for the 2D path's alpha half -- shared, since frames are
// composited one at a time, never concurrently. Never attached to the DOM.
let scratchCanvas = null;

function create2DRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return {
    gpu: false,
    draw(video, brightness = 1) {
      if (!hasFrame(video)) return false;
      scratchCanvas ||= document.createElement("canvas");
      const scratchCtx = scratchCanvas.getContext("2d");
      if (!scratchCtx) return false;
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight / 2; // top half color, bottom half alpha

      ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h);
      const rgbData = ctx.getImageData(0, 0, w, h);

      scratchCanvas.width = w;
      scratchCanvas.height = h;
      scratchCtx.drawImage(video, 0, vh, vw, vh, 0, 0, w, h);
      const alphaPixels = scratchCtx.getImageData(0, 0, w, h).data;

      const rgbPixels = rgbData.data;
      const b = brightness || 1;
      for (let i = 0; i < rgbPixels.length; i += 4) {
        rgbPixels[i + 3] = normalizePackedAlpha(alphaPixels[i]);
        if (b !== 1) {
          rgbPixels[i] = Math.min(255, rgbPixels[i] * b);
          rgbPixels[i + 1] = Math.min(255, rgbPixels[i + 1] * b);
          rgbPixels[i + 2] = Math.min(255, rgbPixels[i + 2] * b);
        }
      }
      ctx.putImageData(rgbData, 0, 0);
      return true;
    },
  };
}
