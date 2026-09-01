"use client";

import { Suspense } from "react";
import ErrorBoundary from "./ErrorBoundary";
import { MinimalErrorSurface } from "./FallbackRenderer";

/**
 * Suspense + ErrorBoundary composition for async trees.
 */
export default function AsyncBoundary({
  children,
  loadingFallback = null,
  errorFallback,
  context = "AsyncBoundary",
  resetKey,
}) {
  const fallback =
    errorFallback ?? (
      <MinimalErrorSurface message="Content failed to load." />
    );

  return (
    <ErrorBoundary context={context} fallback={fallback} resetKey={resetKey}>
      <Suspense fallback={loadingFallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
