import assert from "node:assert/strict";
import test from "node:test";
import { tonemapHdrToSdr } from "../hdr-tonemap.js";

// HDR->SDR tone-mapping is a confirmed, isolated blocker on the current
// production FFmpeg build (zscale cannot convert to linear transfer
// characteristic — see hdr-tonemap.js's header for the full evidence trail).
// This function must fail loudly and specifically, never silently produce
// an unvalidated/incorrect SDR derivative.

test("tonemapHdrToSdr fails loudly with the specific, documented blocker reason — never silently succeeds", async () => {
  await assert.rejects(() => tonemapHdrToSdr(), /HDR->SDR tone-mapping is blocked/);
});
