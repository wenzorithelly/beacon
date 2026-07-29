// Same two spring step-responses as the desktop shell's terminals/motion.css (SwiftUI
// response/dampingFraction model: snap 0.22s/0.78, glide 0.34s/0.92), sampled into plain arrays
// instead of a CSS linear() curve so imperative viewport moves (React Flow's fitView/setCenter,
// whose `ease` option is a (t: number) => number function) can fly with the exact same "arrives
// early, settles late" shape as every CSS-driven transition in the app. Copied verbatim from
// motion.css's --spring-snap / --spring-glide token values — one physical curve, two
// representations. Keep these arrays byte-identical to motion.css if it ever changes.
const SPRING_GLIDE_SAMPLES = [
  0, 0.0202, 0.0709, 0.1402, 0.2195, 0.3025, 0.3849, 0.4637, 0.5371, 0.6041, 0.6642, 0.7175, 0.764,
  0.8044, 0.839, 0.8684, 0.8932, 0.9139, 0.9312, 0.9454, 0.9571, 0.9665, 0.9742, 0.9803, 0.9852,
  0.9891, 0.9921, 0.9944, 0.9962,
];
const SPRING_SNAP_SAMPLES = [
  0, 0.0351, 0.1207, 0.233, 0.355, 0.4754, 0.5868, 0.6851, 0.7687, 0.8373, 0.8919, 0.934, 0.9652,
  0.9875, 1.0026, 1.0121, 1.0174, 1.0196, 1.0198, 1.0186, 1.0166, 1.0143, 1.0118, 1.0095, 1.0074,
  1.0055, 1.004,
];

// CSS `linear()` semantics: the samples are spaced evenly across progress 0..1, and any point
// between two stops is a straight (linear) interpolation between them — same technique here.
function sampledEase(samples: number[]) {
  const last = samples.length - 1;
  return (t: number) => {
    if (t <= 0) return samples[0];
    if (t >= 1) return samples[last];
    const pos = t * last;
    const i = Math.floor(pos);
    return samples[i] + (samples[i + 1] - samples[i]) * (pos - i);
  };
}

/** Panels/cards/canvas moves, no overshoot — the default for fitView/setCenter viewport flights. */
export const easeSpringGlide = sampledEase(SPRING_GLIDE_SAMPLES);
/** Controls/pills/menus, small overshoot — for quick, snappy jumps rather than board-wide flights. */
export const easeSpringSnap = sampledEase(SPRING_SNAP_SAMPLES);

// Seconds (not ms) — the units the `motion` package's `transition.duration` expects. Mirrors
// --dur-spring-glide / --dur-spring-snap in app/globals.css.
export const SPRING_GLIDE_SECONDS = 0.325;
export const SPRING_SNAP_SECONDS = 0.26;
