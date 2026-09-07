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
      r: 1 + Math.random() * 1.8,
      baseOpacity: 0.55 + Math.random() * 0.45,
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
    const opacity = st.baseOpacity * (0.45 + 0.55 * twinkle) * opacityMultiplier;
    if (opacity <= 0.02) continue;
    const x = st.x * width + parallaxX;
    const y = st.y * height + parallaxY;
    const alpha = Math.max(0, Math.min(1, opacity)).toFixed(3);
    // Soft glow so a star reads as a small point of light rather than a
    // flat dot — cheap (one extra shadow per star, no extra draw calls).
    if (glow) {
      ctx.shadowColor = `rgba(${color},${alpha})`;
      ctx.shadowBlur = st.r * 4;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.beginPath();
    ctx.fillStyle = `rgba(${color},${alpha})`;
    ctx.arc(x, y, st.r, 0, TWO_PI);
    ctx.fill();
  }
  if (glow) ctx.shadowBlur = 0;
}

export function lerp(current, target, factor) {
  return current + (target - current) * factor;
}
