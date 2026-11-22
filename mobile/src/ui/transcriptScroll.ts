/** Page mode only scrolls when the active line would fall below the viewport. */
export function shouldPageJump(
  activeTop: number,
  activeBottom: number,
  viewportTop: number,
  viewportHeight: number,
  margin = 24
): boolean {
  if (viewportHeight <= 0) return false;
  return activeBottom > viewportTop + viewportHeight - margin;
}

/** Keep a small gap above the active line after a page jump. */
export function pageScrollTarget(activeTop: number, margin = 24): number {
  return Math.max(0, activeTop - margin);
}
