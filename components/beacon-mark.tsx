// Beacon brand mark — the rounded outline triangle in the brand accent (#ff7a45).
// Hollow, thick stroke, soft corners (the round linejoin at this stroke width IS the
// corner radius) — replaces the earlier filled triangle + beacon-light variant.
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
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M48 16 L83 78 L13 78 Z"
        fill="none"
        stroke="var(--accent-2, #ff7a45)"
        strokeWidth={13}
        strokeLinejoin="round"
      />
    </svg>
  );
}
