// Pure time-of-day computation — reads the local device clock only, no
// network, no dependency on anything else in the app. Returns a fully
// interpolated target so callers never need to hand-blend two phases.

// Per-phase targets. Not a UI theme — only nebula/star opacity, a small hue
// bias, and an animation-speed multiplier.
//   dawn:  dark base, gradually lightening, subtle cool glow, few stars.
//   day:   deep blue/black (never bright white), reduced star visibility,
//          slightly brighter nebula, more ambient depth.
//   dusk:  stars increasing, atmosphere darkening, nebula more visible.
//   night: richest — deepest black, most stars, most depth, slightly
//          stronger atmospheric movement.
const PHASES = [
  { hour: 5, phase: "dawn", starOpacity: 0.65, nebulaOpacity: 0.55, hueBias: -10, speedMultiplier: 0.9 },
  { hour: 8, phase: "day", starOpacity: 0.55, nebulaOpacity: 0.7, hueBias: 8, speedMultiplier: 0.85 },
  { hour: 17, phase: "dusk", starOpacity: 0.8, nebulaOpacity: 0.8, hueBias: -18, speedMultiplier: 1 },
  { hour: 20, phase: "night", starOpacity: 1, nebulaOpacity: 0.9, hueBias: 0, speedMultiplier: 1.1 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function getTimeOfDayTarget(date = new Date()) {
  const rawHour = date.getHours() + date.getMinutes() / 60;
  const hour = rawHour < PHASES[0].hour ? rawHour + 24 : rawHour;

  let from = PHASES[PHASES.length - 1];
  let to = { ...PHASES[0], hour: PHASES[0].hour + 24 };
  for (let i = 0; i < PHASES.length - 1; i++) {
    if (hour >= PHASES[i].hour && hour < PHASES[i + 1].hour) {
      from = PHASES[i];
      to = PHASES[i + 1];
      break;
    }
  }

  const blend = Math.max(0, Math.min(1, (hour - from.hour) / (to.hour - from.hour)));
  return {
    phase: from.phase,
    starOpacity: lerp(from.starOpacity, to.starOpacity, blend),
    nebulaOpacity: lerp(from.nebulaOpacity, to.nebulaOpacity, blend),
    hueBias: lerp(from.hueBias, to.hueBias, blend),
    speedMultiplier: lerp(from.speedMultiplier, to.speedMultiplier, blend),
  };
}
