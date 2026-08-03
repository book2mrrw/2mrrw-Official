/**
 * @typedef {
 *   | { type: 'modal.open.failed', modalId: string, error: string }
 *   | { type: 'playback.failed', trackId: string, error: string }
 *   | { type: 'image.load.failed', src: string, context: string }
 *   | { type: 'audio.stalled', trackId: string, stallDuration: number }
 *   | { type: 'queue.desync', expected: string, actual: string }
 *   | { type: 'render.spike', component: string, duration: number }
 *   | { type: 'transition.failed', from: string, to: string, error: string }
 *   | { type: 'api.response.failed', endpoint: string, status: number }
 *   | { type: 'interaction.slow', interaction: string, duration: number }
 *   | { type: 'performance.measure', mark: string, duration: number }
 *   | { type: 'error.boundary.caught', boundary: string, error: string }
 *   | { type: 'signed.url.expired', assetId: string, context: string }
 *   | { type: 'preload.budget.exceeded', preloadType: string, id: string }
 * } TelemetryEvent
 */

export const TELEMETRY_EVENT_TYPES = [
  "modal.open.failed",
  "playback.failed",
  "image.load.failed",
  "audio.stalled",
  "queue.desync",
  "render.spike",
  "transition.failed",
  "api.response.failed",
  "interaction.slow",
  "performance.measure",
  "error.boundary.caught",
  "signed.url.expired",
  "preload.budget.exceeded",
];
