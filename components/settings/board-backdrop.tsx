// The board texture shown behind the settings modal on a DIRECT /settings load (a hard nav has no
// live board to overlay). A non-interactive dot-grid surface — the same canvas texture the /map and
// /db boards paint — so opening settings by URL still reads as "a modal over your board", matching
// the soft-nav case where the real board sits behind. Cheap and static: no canvas, no data.
export function BoardBackdrop() {
  return (
    <div aria-hidden className="canvas-dots pointer-events-none fixed inset-0 z-0" />
  );
}
