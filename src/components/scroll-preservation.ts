export interface ScrollSnapshot { x: number; y: number; anchors: Array<{ key: string; top: number }>; }
export interface ScrollEnvironment {
  position(): { x: number; y: number };
  anchors(): Array<{ key: string; top: number; bottom: number }>;
  move(x: number, y: number): void;
}
export function captureScroll(environment: ScrollEnvironment): ScrollSnapshot {
  return { ...environment.position(), anchors: environment.anchors().filter(anchor => anchor.bottom > 0).slice(0, 4).map(({ key, top }) => ({ key, top })) };
}
export function restoreScroll(snapshot: ScrollSnapshot, environment: ScrollEnvironment) {
  const current = environment.anchors();
  for (const anchor of snapshot.anchors) {
    const found = current.find(item => item.key === anchor.key);
    if (found) {
      const position = environment.position();
      if (Math.abs(found.top - anchor.top) > 0.5) environment.move(position.x, Math.max(0, position.y + found.top - anchor.top));
      return;
    }
  }
  const position = environment.position();
  if (Math.abs(position.y - snapshot.y) > 0.5) environment.move(snapshot.x, snapshot.y);
}
export const browserScroll: ScrollEnvironment = {
  position: () => ({ x: window.scrollX, y: window.scrollY }),
  anchors: () => Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-anchor], .page-footer'))
  .filter(element => !['sticky', 'fixed'].includes(window.getComputedStyle(element).position)).map(element => {
    const rect = element.getBoundingClientRect();
    return { key: element.dataset.scrollAnchor ?? 'page-footer', top: rect.top, bottom: rect.bottom };
  }),
  move: (x, y) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
};
