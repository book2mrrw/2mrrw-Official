"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  MEDIA_FAILED,
  MEDIA_PENDING,
  MEDIA_READY,
  mediaElementOutcome,
  mediaReadyEventName,
} from "@/lib/media/element-readiness";

/**
 * The readiness authority for cover media. Every surface that reveals a cover
 * consumes this; no surface reimplements it.
 *
 * Returns `{ ready, failed, attach }`. Put `attach` on the `<img>` / `<video>`
 * in place of `onLoad` / `onError` props: when it attaches it reads the
 * element's real state first, and only subscribes to events when the element
 * genuinely has not settled yet — so an asset that finished before React
 * hydrated is reported immediately instead of waiting forever for an event
 * that already fired. See `@/lib/media/element-readiness` for why that
 * ordering is mandatory.
 *
 * Destructure the result into separate bindings
 * (`const { ready, attach } = useCoverReady(...)`) rather than keeping the
 * object and reading `x.ready` during render. Passing `x.attach` to a `ref`
 * prop makes the React Compiler treat the whole object as a ref, and reading
 * any other property of it during render is then reported as a ref access.
 *
 * `onReady` / `onFailed` are invoked at most once per (src, outcome) with the
 * settled element, and must be referentially stable (`useCallback`) — a new
 * identity detaches and re-attaches the ref, which is harmless but wasteful.
 *
 * @param {object}   params
 * @param {string?}  params.src   Active source; falsy disables the hook entirely.
 * @param {"image"|"video"} params.kind
 * @param {(element: Element, src: string) => void} [params.onReady]
 * @param {(element: Element, src: string) => void} [params.onFailed]
 */
export function useCoverReady({ src, kind = "image", onReady, onFailed }) {
  const [readySrc, setReadySrc] = useState(null);
  const [failedSrc, setFailedSrc] = useState(null);

  // Latest-ref pattern. `attach` runs during the commit phase, before any
  // effect in that same commit, so the mount-time callbacks must be captured
  // eagerly here rather than assigned by an effect that has not run yet.
  const onReadyRef = useRef(onReady);
  const onFailedRef = useRef(onFailed);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
    onFailedRef.current = onFailed;
  }, [onReady, onFailed]);

  // Guards against re-reporting the same outcome for the same source when the
  // element is re-attached (a parent re-render, a callback identity change).
  const settledRef = useRef({ src: null, outcome: null });

  const settle = useCallback((element, outcome, forSrc) => {
    const settled = settledRef.current;
    if (settled.src === forSrc && settled.outcome === outcome) return;
    settledRef.current = { src: forSrc, outcome };
    if (outcome === MEDIA_READY) {
      setReadySrc(forSrc);
      onReadyRef.current?.(element, forSrc);
    } else {
      setFailedSrc(forSrc);
      onFailedRef.current?.(element, forSrc);
    }
  }, []);

  const attach = useCallback(
    (element) => {
      if (!element || !src) return () => {};

      // State before events. An asset that settled before this ref attached
      // dispatched its event into nothing, so no listener can ever hear it —
      // reading the element is the only way to recover that case.
      const outcome = mediaElementOutcome(element, kind);
      if (outcome !== MEDIA_PENDING) {
        settle(element, outcome, src);
        return () => {};
      }

      // Genuinely still loading, so an event is now the correct mechanism.
      const readyEvent = mediaReadyEventName(kind);
      const handleReady = () => settle(element, MEDIA_READY, src);
      const handleFailed = () => settle(element, MEDIA_FAILED, src);
      element.addEventListener(readyEvent, handleReady);
      element.addEventListener("error", handleFailed);
      return () => {
        element.removeEventListener(readyEvent, handleReady);
        element.removeEventListener("error", handleFailed);
      };
    },
    [src, kind, settle]
  );

  return {
    ready: Boolean(src) && readySrc === src,
    failed: Boolean(src) && failedSrc === src,
    attach,
  };
}

export default useCoverReady;
