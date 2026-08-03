"use client";

import { useSessionRecovery, useScrollRecovery } from "@/system/recovery";

export default function SessionRecoveryRoot({ children }) {
  useSessionRecovery();
  useScrollRecovery();
  return children;
}
