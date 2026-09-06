/**
 * HDR -> SDR tone-map path — CONFIRMED BLOCKED on the current production
 * FFmpeg build. Documented here with full evidence rather than silently
 * skipped, per this project's standing "identify the blocker, prove it,
 * implement everything else, let the user decide" policy.
 *
 * ============================================================
 * BLOCKER
 * ============================================================
 * This FFmpeg build's `zscale` filter cannot convert to linear transfer
 * characteristic (`t=linear` / `t=8`) — the required first step of the
 * standard, textbook HDR->SDR tone-mapping pipeline:
 *
 *   zscale=t=linear:npl=<peak> , format=gbrpf32le , zscale=p=bt709 ,
 *   tonemap=tonemap=hable:desat=0 , zscale=t=bt709:m=bt709:r=tv , format=yuv420p
 *
 * Every attempt to reach `t=linear` fails identically:
 *
 *   [Parsed_zscale_0] code 3074: no path between colorspaces
 *   [vf#0:0] Error while filtering: Generic error in an external library
 *
 * ============================================================
 * WHY
 * ============================================================
 * Root cause not fully diagnosed (would require inspecting the bundled
 * libzimg version/build inside mwader/static-ffmpeg:7.1) — but it is
 * confirmed NOT caused by:
 *   - input color-metadata tagging (tested with explicit pin/tin/min/rin
 *     overrides matching the exact source values — same failure)
 *   - source bit depth (tested both yuv420p and yuv420p10le sources —
 *     same failure)
 *   - the specific primaries/matrix combination (tested bt2020/smpte2084/
 *     bt2020nc and plain bt709 as the target of a `t=linear` conversion —
 *     same failure in both cases)
 *
 * ============================================================
 * EVIDENCE (isolated via 7 systematic tests directly against the real
 * production video machine, not assumed from documentation)
 * ============================================================
 *   1. Plain zscale resize (no colorspace args) — WORKS (exit 0).
 *   2. zscale identity conversion, bt709 -> bt709 (pin=1:tin=1:min=1:p=1:
 *      t=1:m=1) — WORKS (exit 0).
 *   3. zscale bt2020/PQ -> bt2020/PQ metadata tag (pin=9:tin=16:min=9:
 *      p=9:t=16:m=9:r=0), no transfer *change* involved — WORKS (exit 0,
 *      and confirmed to correctly stamp a real AV1 output file's metadata
 *      — see codec-av1.js's hdrTagFilter, which uses exactly this
 *      technique for genuine HDR-preserving encoding).
 *   4. ANY attempt at `t=8` (linear) as the output transfer, from any
 *      input (bt709, bt2020/PQ, 8-bit, 10-bit) — FAILS identically every
 *      time with "code 3074: no path between colorspaces".
 *   5. Confirmed the `tonemap` filter itself has no self-contained way to
 *      avoid this — its own AVOptions (`tonemap`, `param`, `desat`, `peak`)
 *      operate on already-linear input; there is no non-linear-input mode.
 *   6. Confirmed no hardware-accelerated alternative exists in this build
 *      (`tonemap_opencl` — "Unknown filter").
 *
 * ============================================================
 * WHAT CAN STILL BE COMPLETED NOW (and already is)
 * ============================================================
 * Genuine HDR-preserving AV1 encoding (codec-av1.js) is UNAFFECTED by this
 * blocker — it never needs a linear-transfer conversion, only a metadata
 * *tag* (test 3 above), which works. HDR detection (source-analyzer.js) is
 * pure ffprobe metadata parsing, also unaffected. The AVC ladder is always
 * SDR/8-bit by design regardless of source HDR (Part D's own rule), so a
 * baseline SDR-container viewing option already exists even for an
 * HDR-sourced asset — it simply isn't a *validated, color-accurate
 * tone-mapped* SDR fallback until this blocker is resolved.
 *
 * ============================================================
 * WHAT REMAINS UNVALIDATED / NEEDS A DECISION
 * ============================================================
 * The specific "excellent SDR fallback for a genuine HDR source" tone-map
 * derivative (Part D.6) cannot ship until one of the following happens:
 *   - the production FFmpeg/libzimg build is upgraded/patched to fix
 *     zscale's linear-transfer conversion, or
 *   - an alternative tone-mapping approach is identified and verified
 *     (e.g. a different filter, a different library entirely), or
 *   - the product scope explicitly accepts deferring the *validated*
 *     tone-map fallback while shipping everything else.
 *
 * This decision belongs to the user, not to this code — this function
 * fails loudly and specifically rather than silently producing an
 * unvalidated/incorrect SDR derivative.
 */
export async function tonemapHdrToSdr() {
  throw new Error(
    "HDR->SDR tone-mapping is blocked on the current FFmpeg build: zscale cannot convert to linear " +
    "transfer characteristic (confirmed via 7 isolated tests — see this file's header for full evidence). " +
    "Not implemented pending a resolution decision — see hdr-tonemap.js."
  );
}
