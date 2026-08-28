"use client";

import { useEffect } from "react";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";

/**
 * Hydration instrumentation only. Consumer admission is decided before render
 * by the server route policy and verified Supabase principal, never by this
 * client component or React bootstrap timing.
 */
export default function AppAuthRoot({ children }) {
  useEffect(() => {
    perfMark(MARKS.HYDRATION_START);
    perfMark(MARKS.HYDRATION_END);
  }, []);

  return children;
}
