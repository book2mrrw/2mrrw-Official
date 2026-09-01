"use client";

import { useEffect, useRef } from "react";

/** @returns {React.MutableRefObject<boolean>} */
export function useMountedRef() {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
