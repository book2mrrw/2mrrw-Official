"use client";

import { useEffect } from "react";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";

/**
 * Public presentation is never replaced during hydration or blocked by identity
 * bootstrap. Protected actions open AuthGate through AuthGateContext; protected
 * routes and mutations retain their server-side authority checks.
 */
export default function AppAuthRoot({ children }) {
  useEffect(() => {
    perfMark(MARKS.HYDRATION_START);
    perfMark(MARKS.HYDRATION_END);
  }, []);

  return children;
}
