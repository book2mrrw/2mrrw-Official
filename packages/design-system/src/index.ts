/**
 * @2mrrw/design-system — canonical design tokens.
 *
 * Platform-agnostic: consumed by apps/web (CSS variables / Tailwind)
 * and apps/mobile (NativeWind / StyleSheet).
 * No React components here — tokens only.
 */

// ─── Color Palette ────────────────────────────────────────────────────────────

export const colors = {
  background: {
    light: '#ffffff',
    dark: '#0a0a0a',
  },
  foreground: {
    light: '#171717',
    dark: '#ededed',
  },
  /** Platform accent — turquoise glow used on titles and highlights. */
  accent: {
    primary: 'rgba(0, 255, 255, 1)',
    glow: 'rgba(0, 255, 255, 0.55)',
    glowSoft: 'rgba(0, 255, 255, 0.22)',
    turquoise: 'rgba(0, 220, 210, 0.28)',
  },
  /** Text hierarchy. */
  text: {
    muted: '#aaa',
    mutedLight: '#c8c8c8',
  },
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────

export const fonts = {
  /** Display / editorial — Cormorant Garamond, weights 300–600. */
  display: 'Cormorant Garamond, serif',
  /** Monospace — DM Mono, weights 300–500. */
  mono: 'DM Mono, monospace',
  /** UI body — Outfit, weights 300–900. */
  sans: 'Outfit, sans-serif',
} as const;

export const fontWeights = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

// ─── Motion Tokens ────────────────────────────────────────────────────────────

export const motion = {
  duration: {
    fast: 180,    // ms
    base: 340,
    slow: 480,
  },
  easing: {
    out: 'cubic-bezier(0.33, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  press: {
    scale: 0.97,
  },
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────

/** 4-point spacing scale (values in px). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export type SpacingKey = keyof typeof spacing;

// ─── Border Radius ────────────────────────────────────────────────────────────

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// ─── Z-Index ──────────────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  raised: 10,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  player: 450,
  toast: 500,
  tooltip: 600,
} as const;

export type ZIndexKey = keyof typeof zIndex;

// ─── Player Dimensions ────────────────────────────────────────────────────────

/** Global audio player bar — matches the web shell implementation. */
export const playerBar = {
  heightPx: 64,
  mobileHeightPx: 56,
} as const;
