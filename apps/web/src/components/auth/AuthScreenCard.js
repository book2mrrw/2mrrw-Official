"use client";

const CARD_STYLE = {
  width: "min(420px, calc(100vw - 32px))",
  background: "#111",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "1rem",
  padding: "2rem",
  boxSizing: "border-box",
};

const BRAND_BLOCK_STYLE = {
  textAlign: "center",
  marginBottom: "24px",
};

const BRAND_STYLE = {
  fontSize: "22px",
  fontWeight: "300",
  letterSpacing: "0.3em",
  color: "#fff",
  lineHeight: "1",
  whiteSpace: "nowrap",
  textShadow:
    "0 0 14px rgba(0,255,255,0.55), 0 0 28px rgba(0,255,255,0.22)",
};

export function AuthBrandBlock() {
  return (
    <div style={BRAND_BLOCK_STYLE}>
      <div style={BRAND_STYLE}>2MRRW</div>
    </div>
  );
}

export default function AuthScreenCard({
  children,
  variant = "root",
  sheetDragY = 0,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
}) {
  const isRoot = variant === "root";

  return (
    <div
      style={{
        ...CARD_STYLE,
        ...(isRoot
          ? {}
          : {
              transform:
                sheetDragY > 0
                  ? `translateY(${sheetDragY}px)`
                  : undefined,
              transition:
                sheetDragY > 0 ? "none" : "transform 0.2s ease",
            }),
      }}
      onTouchStart={isRoot ? undefined : onTouchStart}
      onTouchMove={isRoot ? undefined : onTouchMove}
      onTouchEnd={isRoot ? undefined : onTouchEnd}
      onTouchCancel={isRoot ? undefined : onTouchCancel}
    >
      {!isRoot ? (
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.2)",
            margin: "0 auto 16px",
          }}
          aria-hidden="true"
        />
      ) : null}
      <AuthBrandBlock />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
