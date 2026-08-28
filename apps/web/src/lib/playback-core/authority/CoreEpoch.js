/**
 * Runtime lifetime authority. Cleanup remains mandatory; an epoch is the final
 * rejection boundary for callbacks that survive cleanup or settle out of order.
 */
export class CoreEpoch {
  #runtimeId;
  #generation = 1;
  #disposed = false;

  constructor(runtimeId) {
    if (!runtimeId) throw new TypeError("[CoreEpoch] runtimeId is required");
    this.#runtimeId = runtimeId;
  }

  get current() {
    return `${this.#runtimeId}:${this.#generation}`;
  }

  isCurrent(epoch) {
    return !this.#disposed && epoch === this.current;
  }

  rotate() {
    if (this.#disposed) return this.current;
    this.#generation += 1;
    return this.current;
  }

  dispose() {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#disposed = true;
  }
}
