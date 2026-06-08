// Beacon brand mark — the triangle (favicon shape) emitting its #ff7a45 signal light.
// Triangle inherits `currentColor`; the beacon light uses the app's accent (var(--accent-2)).
export function BeaconMark({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="11 1.5 74 74"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="beacon-mark-beam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffb27a" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#ff7a45" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ff7a45" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M48 30 L40 4 L56 4 Z" fill="url(#beacon-mark-beam)" />
      <path
        d="M48 33 L72.5 73 L23.5 73 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <circle
        cx="48"
        cy="31"
        r="5.2"
        fill="var(--accent-2, #ff7a45)"
        style={{ filter: "drop-shadow(0 0 4px var(--accent-2, #ff7a45))" }}
      />
      <circle cx="48" cy="31" r="2" fill="#ffd9c2" />
    </svg>
  );
}
