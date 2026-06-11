// Beacon brand mark — the SAME artwork as the favicon (app/icon.svg): the rounded
// outline triangle with the beacon-light dot above the apex, in the brand accent.
// Keep the two in lockstep — the favicon is the canonical drawing, not a variant.
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
      viewBox="20 22 56 56"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M48 33 L72.5 73 L23.5 73 Z"
        fill="none"
        stroke="var(--accent-2, #ff7a45)"
        strokeWidth={7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="48" cy="29.5" r="7" fill="var(--accent-2, #ff7a45)" />
    </svg>
  );
}
