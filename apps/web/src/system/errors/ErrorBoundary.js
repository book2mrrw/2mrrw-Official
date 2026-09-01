"use client";

import { Component } from "react";
import { clientLog } from "@/lib/observability/client-log";
import { MinimalErrorSurface } from "./FallbackRenderer";

function logBoundaryTelemetry(payload) {
  try {
    // Step 2 — typed telemetry bus
    import("@/system/telemetry")
      .then(({ telemetry }) => {
        if (telemetry?.log) telemetry.log(payload);
      })
      .catch(() => {});
  } catch {
    /* telemetry optional */
  }
}

/**
 * Base error boundary — class component for componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const boundary = this.props.context || "ErrorBoundary";
    clientLog("error", "boundary_caught", {
      boundary,
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });
    logBoundaryTelemetry({
      type: "error.boundary.caught",
      boundary,
      error: error?.message || "unknown",
    });
    import("@sentry/nextjs")
      .then(({ captureException }) => captureException(error, { extra: { boundary, componentStack: errorInfo?.componentStack } }))
      .catch(() => {});
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <MinimalErrorSurface
          message="Something went wrong in this view."
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}
