"use client";

import { memo } from "react";

/** CSS-only content insets; viewport geometry never enters React state. */
const ScrollPaddingShell = memo(function ScrollPaddingShell({ children }) {
  return (
    <div className="storefront-scroll-padding-shell">
      <div className="storefront-scroll-padding-inner">{children}</div>
    </div>
  );
});

export default ScrollPaddingShell;
