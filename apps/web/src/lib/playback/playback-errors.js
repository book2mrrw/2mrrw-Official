/**
 * Typed playback error factory — gives every thrown error a machine-readable
 * `code` field alongside the human message, usable in catch blocks without
 * string matching on `.message`.
 *
 * @param {string} code   Machine-readable error code (e.g. "PLAYBACK_COMMAND_TIMEOUT").
 * @param {string} message  Human-readable description.
 * @param {Record<string, any>} [context]  Extra diagnostic fields merged onto the error.
 * @returns {Error & { code: string }}
 */
export function createPlaybackError(code, message, context = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, context);
  return error;
}
