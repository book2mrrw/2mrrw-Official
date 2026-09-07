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
      r: 0.4 + Math.random() * 1.3,
      baseOpacity: 0.35 + Math.random() * 0.55,
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

export function drawStarField(ctx, stars, { width, height, elapsedSeconds, color = "255,255,255", opacityMultiplier = 1, parallaxX = 0, parallaxY = 0 }) {
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    const twinkle = 0.5 + 0.5 * Math.sin(elapsedSeconds * st.twinkleSpeed * TWO_PI + st.twinklePhase);
    const opacity = st.baseOpacity * (0.45 + 0.55 * twinkle) * opacityMultiplier;
    if (opacity <= 0.01) continue;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${color},${Math.max(0, Math.min(1, opacity)).toFixed(3)})`;
    ctx.arc(st.x * width + parallaxX, st.y * height + parallaxY, st.r, 0, TWO_PI);
    ctx.fill();
  }
}

export function lerp(current, target, factor) {
  return current + (target - current) * factor;
}
