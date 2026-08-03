/**
 * Server-Timing collector for playback hot paths.
 * Emits standard Server-Timing headers; optional X-Playback-Timing in dev/debug.
 */

const DEBUG_TIMING =
  process.env.R2_STREAM_DEBUG === "1" || process.env.NODE_ENV === "development";

/**
 * @param {string} [totalName]
 * @returns {{
 *   mark: (name: string, desc?: string) => void,
 *   apply: (response: Response) => Response,
 *   toObject: () => Record<string, number>,
 * }}
 */
export function createServerTiming(totalName = "total") {
  const start = performance.now();
  /** @type {{ name: string, dur: number, desc?: string }[]} */
  const segments = [];
  let lastMark = start;

  return {
    mark(name, desc) {
      const now = performance.now();
      segments.push({ name, dur: Math.max(0, now - lastMark), desc });
      lastMark = now;
    },
    toObject() {
      const out = Object.fromEntries(
        segments.map(({ name, dur }) => [name, Math.round(dur * 10) / 10])
      );
      out[totalName] = Math.round((performance.now() - start) * 10) / 10;
      return out;
    },
    apply(response) {
      const total = performance.now() - start;
      const headerParts = segments.map(({ name, dur, desc }) => {
        const d = Math.max(0, Math.round(dur * 10) / 10);
        return desc ? `${name};dur=${d};desc="${desc}"` : `${name};dur=${d}`;
      });
      headerParts.push(`${totalName};dur=${Math.round(total * 10) / 10}`);
      response.headers.set("Server-Timing", headerParts.join(", "));
      if (DEBUG_TIMING) {
        response.headers.set("X-Playback-Timing", JSON.stringify(this.toObject()));
      }
      return response;
    },
  };
}
