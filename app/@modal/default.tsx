// Fallback for the @modal parallel slot when no modal route is active (every page other than a
// soft-navigated /settings, and on any hard load). Rendering null keeps the slot resolved so the
// board pages render normally without the modal.
export default function Default() {
  return null;
}
