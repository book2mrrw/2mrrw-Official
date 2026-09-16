import { HLSEngine } from '@/lib/audio/HLSEngine';
import { bufferedAhead } from '@/lib/audio/playback-buffer';
import { waitAudioSrcReady } from '@/lib/audio/audio-element-utils';
import { getQualityLevel, getManifestTimeoutMs } from '@/lib/audio/network-quality';
import { libraryHlsManifestUrl, isLibraryStreamSrc, parseStreamSlugFromSrc, parseStreamTrackSlugFromSrc } from '../stream-client';
import { libraryStreamRedirectSrc } from '@/lib/music-access';

// Preparation is silent and uses the existing authenticated HLS/progressive
// endpoints. It never starts a second server stream session or changes active HLS.
export async function prepareDeck(engine, candidate) {
  const { next: track, abort } = candidate;
  const signal = abort.signal;
  if (signal.aborted) return null;
  let element = engine.getStandbyElement();
  if (!element) {
    element = document.createElement('audio');
    element.preload = 'auto';
    element.crossOrigin = 'anonymous';
    element.setAttribute('playsinline', '');
    element.style.display = 'none';
    document.body.appendChild(element);
    if (!engine.bindStandbyElement(element).ok) { element.remove(); return null; }
  }
  element.muted = true;
  element.pause();
  const hls = new HLSEngine();
  let failed = false;
  let transferred = false;
  let released = false;
  const release = () => {
    if (transferred || released) return;
    released = true;
    hls.detach();
    element.pause();
    element.removeAttribute('src');
    element.load();
    signal.removeEventListener('abort', release);
  };
  signal.addEventListener('abort', release, { once: true });
  const ready = () => !released && !failed && !signal.aborted && element.readyState >= 3 && bufferedAhead(element) >= 5;
  try {
    let loaded = false;
    if (isLibraryStreamSrc(track.src)) {
      const slug = parseStreamSlugFromSrc(track.src) || track.slug;
      const raw = track.metadata?.trackSlug || parseStreamTrackSlugFromSrc(track.src);
      const trackSlug = raw && raw !== slug ? raw : null;
      hls.setQualityLevel(await getQualityLevel());
      if (signal.aborted) return null;
      loaded = await hls.loadTrack(libraryHlsManifestUrl(slug, trackSlug), element, { startPosition: 0, manifestTimeoutMs: getManifestTimeoutMs() });
      if (!loaded && !signal.aborted) {
        hls.detach();
        await waitAudioSrcReady(element, `${libraryStreamRedirectSrc(slug, { trackSlug })}&preload=1`, { signal });
      }
    } else {
      await waitAudioSrcReady(element, track.src, { signal });
    }
    if (signal.aborted) return null;
    hls.onError = hls.onSegmentFatalError = () => { failed = true; };
    if (!ready()) {
      await new Promise((resolve) => {
        const cleanup = () => {
          clearTimeout(timer);
          for (const event of ['canplay', 'progress', 'canplaythrough']) element.removeEventListener(event, check);
          signal.removeEventListener('abort', cleanup);
          resolve();
        };
        const check = () => { if (ready() || signal.aborted || failed) cleanup(); };
        const timer = setTimeout(cleanup, 6000);
        for (const event of ['canplay', 'progress', 'canplaythrough']) element.addEventListener(event, check);
        signal.addEventListener('abort', cleanup, { once: true });
        check();
      });
    }
    if (!ready()) { release(); return null; }
    return {
      element, hls: loaded ? hls : null, ready, release,
      async prime() {
        if (!ready()) return false;
        // Muted validation cannot leak audible playback before Core authorizes it.
        await element.play();
        return !element.paused && ready();
      },
      transfer() {
        transferred = true;
        signal.removeEventListener('abort', release);
      },
    };
  } catch {
    release();
    return null;
  }
}
