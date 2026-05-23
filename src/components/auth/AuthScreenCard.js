"use client";

export function AuthBrandBlock() {
  return (
    <div className="auth-brand-block">
      <div className="auth-brand auth-brand-refined hero-title-glow">2MRRW</div>
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
      className={isRoot ? "auth-card auth-card--elevated auth-card--ref" : "auth-card auth-card--sheet auth-card--elevated auth-card--ref"}
      onTouchStart={isRoot ? undefined : onTouchStart}
      onTouchMove={isRoot ? undefined : onTouchMove}
      onTouchEnd={isRoot ? undefined : onTouchEnd}
      onTouchCancel={isRoot ? undefined : onTouchCancel}
      style={
        isRoot
          ? undefined
          : {
              transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
              transition: sheetDragY > 0 ? "none" : "transform 0.2s ease",
            }
      }
    >
      {!isRoot ? <div className="auth-sheet-handle" aria-hidden="true" /> : null}
      <AuthBrandBlock />
      <div className="auth-card-body">{children}</div>
    </div>
  );
}
