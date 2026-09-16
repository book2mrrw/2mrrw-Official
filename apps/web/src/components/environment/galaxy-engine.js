// Pure, framework-independent star-field engine for the galaxy environment.
// No React, no DOM assumptions beyond a 2D canvas context, no imports from
// anywhere else in the app. Positions are stored as [0,1] fractions of the
// canvas so a resize only needs to rescale draw coordinates, never
// regenerate the field.

const TWO_PI = Math.PI * 2;

export function createStarField(count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 1.3 + Math.random() * 2.2,
      baseOpacity: 0.65 + Math.random() * 0.35,
      twinkleSpeed: 0.15 + Math.random() * 0.35, // cycles per second — slow, never synchronized
      twinklePhase: Math.random() * TWO_PI,
      vx: (Math.random() - 0.5) * 0.0025, // fraction of width per second — slow drift
      vy: (Math.random() - 0.5) * 0.0025,
    });
  }
  return stars;
}

// Grows or shrinks a field toward targetCount without discarding existing
// stars' identity (so a density change doesn't visibly "reset" the sky).
export function resizeStarField(stars, targetCount) {
  if (targetCount === stars.length) return stars;
  if (targetCount < stars.length) return stars.slice(0, targetCount);
  return stars.concat(createStarField(targetCount - stars.length));
}

export function stepStarField(stars, dtSeconds) {
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    st.x += st.vx * dtSeconds;
    st.y += st.vy * dtSeconds;
    if (st.x < -0.02) st.x = 1.02;
    else if (st.x > 1.02) st.x = -0.02;
    if (st.y < -0.02) st.y = 1.02;
    else if (st.y > 1.02) st.y = -0.02;
  }
}

export function drawStarField(ctx, stars, { width, height, elapsedSeconds, color = "255,255,255", opacityMultiplier = 1, parallaxX = 0, parallaxY = 0, glow = true }) {
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    const twinkle = 0.5 + 0.5 * Math.sin(elapsedSeconds * st.twinkleSpeed * TWO_PI + st.twinklePhase);
    // Wide swing (15%-100% of base) so the brighten/dim cycle actually
    // reads as pulsing, not a faint shimmer.
    const opacity = st.baseOpacity * (0.15 + 0.85 * twinkle) * opacityMultiplier;
    if (opacity <= 0.02) continue;
    const x = st.x * width + parallaxX;
    const y = st.y * height + parallaxY;
    const alpha = Math.max(0, Math.min(1, opacity));
    const colorStr = `rgba(${color},${alpha.toFixed(3)})`;

    // Real-looking star: a small bright core plus four tapered points —
    // the classic sparkle/diffraction-spike look of an actual bright star
    // — instead of a flat blurred dot. A little shadowBlur still softens
    // the core so it doesn't look like a hard vector icon, but the sparkle
    // shape (not the blur) is what reads as "real" now.
    if (glow) {
      ctx.shadowColor = colorStr;
      ctx.shadowBlur = st.r * 2.2;
    } else {
      ctx.shadowBlur = 0;
    }

    const tip = st.r * 3.4;
    const inner = st.r * 0.85;
    ctx.beginPath();
    ctx.moveTo(x, y - tip);
    ctx.lineTo(x + inner, y - inner);
    ctx.lineTo(x + tip, y);
    ctx.lineTo(x + inner, y + inner);
    ctx.lineTo(x, y + tip);
    ctx.lineTo(x - inner, y + inner);
    ctx.lineTo(x - tip, y);
    ctx.lineTo(x - inner, y - inner);
    ctx.closePath();
    ctx.fillStyle = colorStr;
    ctx.fill();

    // Bright pinpoint core on top so small/dim stars still read crisply.
    ctx.beginPath();
    ctx.arc(x, y, st.r * 0.42, 0, TWO_PI);
    ctx.fill();
  }
  if (glow) ctx.shadowBlur = 0;
}

export function lerp(current, target, factor) {
  return current + (target - current) * factor;
}
