// Clamp a desired top-left (viewport coords, for a position:fixed box) so a w×h floating element
// stays fully on-screen with a margin. The /plan annotation popover + comment composer anchor at
// the text selection; without this they fly off-screen for selections near an edge or spanning
// many lines (the box is anchored at the selection and can exceed the viewport).
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  viewportW: number,
  viewportH: number,
  margin = 8,
): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, viewportW - w - margin)),
    top: Math.max(margin, Math.min(y, viewportH - h - margin)),
  };
}
