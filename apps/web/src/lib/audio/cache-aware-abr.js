import { memoryDeliveredStats } from "./hls-prefetch-loader";

const controllers = new WeakMap();
const ignoreMeasurement = () => {};

/** Preserve upstream ABR bookkeeping; only network delivery may train its estimator.
 * These synchronous hooks are covered against the installed hls.js implementation.
 */
export function createCacheAwareAbrController(BaseController) {
  if (controllers.has(BaseController)) return controllers.get(BaseController);
  class CacheAwareAbrController extends BaseController {
    _withDeliveryMeasurements(data, run) {
      const stats = data.part?.stats || data.frag.stats;
      if (!memoryDeliveredStats.has(stats)) return run();
      const estimator = this.bwEstimator;
      const sample = estimator.sample;
      const sampleTTFB = estimator.sampleTTFB;
      estimator.sample = estimator.sampleTTFB = ignoreMeasurement;
      try {
        return run();
      } finally {
        estimator.sample = sample;
        estimator.sampleTTFB = sampleTTFB;
      }
    }

    onFragLoaded(event, data) {
      return this._withDeliveryMeasurements(data, () => super.onFragLoaded(event, data));
    }

    onFragBuffered(event, data) {
      return this._withDeliveryMeasurements(data, () => super.onFragBuffered(event, data));
    }
  }
  controllers.set(BaseController, CacheAwareAbrController);
  return CacheAwareAbrController;
}
