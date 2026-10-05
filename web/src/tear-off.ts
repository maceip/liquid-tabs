import { clamp } from './geometry.ts';

export interface PreviewRect { x: number; y: number; width: number; height: number }

/** One inert visual copy per lift. The original page and actual tab stay mounted.
 * The tab enters the browser's top layer without being reparented. */
export class TearOffPreview {
  readonly thumbnail: { width: number; height: number };
  private page = document.createElement('div');
  private content = document.createElement('div');
  private sourceWidth: number;
  private sourceHeight: number;
  blend = 0;
  target = 0;
  private from = 0;
  private began = 0;
  rect: PreviewRect;

  constructor(private node: HTMLElement, source: HTMLElement | null, rect: PreviewRect) {
    this.rect = { ...rect };
    const bounds = source?.getBoundingClientRect();
    this.sourceWidth = Math.max(1, bounds?.width || 800);
    this.sourceHeight = Math.max(1, bounds?.height || 500);
    const scale = Math.min(110 / this.sourceWidth, 150 / this.sourceHeight);
    this.thumbnail = { width: this.sourceWidth * scale, height: this.sourceHeight * scale };
    this.page.className = 'tab-page-preview'; this.page.inert = true;
    this.page.setAttribute('aria-hidden', 'true'); this.content.className = 'tab-preview-content';
    this.content.style.width = `${this.sourceWidth}px`; this.content.style.height = `${this.sourceHeight}px`;
    if (source) {
      const copy = source.cloneNode(true) as HTMLElement;
      const originals = [source, ...source.querySelectorAll('*')];
      const copies = [copy, ...copy.querySelectorAll('*')];
      copies.forEach((element, index) => {
        element.removeAttribute('id'); element.removeAttribute('autofocus'); element.removeAttribute('name');
        const original = originals[index];
        // Freeze the source's presentation once. Inherited tab/button styles
        // must not restyle the miniature when it lives inside the lifted tab.
        if (element instanceof HTMLElement && original instanceof HTMLElement) {
          const style = getComputedStyle(original);
          element.style.cssText = Array.from(style, property => `${property}:${style.getPropertyValue(property)};`).join('');
        }
        if (element instanceof HTMLTextAreaElement && original instanceof HTMLTextAreaElement) element.value = original.value;
        if (element instanceof HTMLInputElement && original instanceof HTMLInputElement) { element.value = original.value; element.checked = original.checked; }
        if (element instanceof HTMLCanvasElement && original instanceof HTMLCanvasElement) element.getContext('2d')?.drawImage(original, 0, 0);
        // A preview must never execute content or start another browsing/media session.
        if (element.matches('script,iframe,object,embed,audio,video')) element.remove();
      });
      copy.hidden = false; copy.inert = true;
      copy.style.width = `${this.sourceWidth}px`; copy.style.height = `${this.sourceHeight}px`;
      copy.style.margin = '0'; copy.style.overflow = 'hidden';
      this.content.append(copy);
    }
    this.page.append(this.content); node.append(this.page);
    node.setAttribute('popover', 'manual'); node.showPopover();
    this.paint(rect, rect.width);
  }

  setDetached(detached: boolean, now: number): void {
    const target = detached ? 1 : 0;
    if (target === this.target) return;
    this.from = this.blend; this.target = target; this.began = now;
  }

  advance(now: number, animate: boolean): void {
    const t = animate ? clamp((now - this.began) / 250, 0, 1) : 1;
    this.blend = this.from + (this.target - this.from) * t * t * (3 - 2 * t);
  }

  paint(rect: PreviewRect, inlineWidth: number): void {
    this.rect = { ...rect };
    const radius = 18 - 15 * this.blend;
    this.node.style.setProperty('--tear-blend', String(this.blend));
    this.node.style.setProperty('--tear-radius', `${radius}px`);
    this.node.style.setProperty('--foreground-width', `${inlineWidth}px`);
    this.node.style.setProperty('--foreground-scale', String(Math.min(1, rect.width / inlineWidth)));
    this.node.style.transform = `translate3d(${rect.x}px,${rect.y}px,0)`;
    this.node.style.width = `${rect.width}px`; this.node.style.height = `${rect.height}px`;
    const scale = Math.max(rect.width / this.sourceWidth, rect.height / this.sourceHeight);
    this.content.style.transform = `translateX(${(rect.width - this.sourceWidth * scale) / 2}px) scale(${scale})`;
  }

  destroy(): void {
    this.node.hidePopover(); this.node.removeAttribute('popover'); this.page.remove();
    for (const property of ['--tear-blend', '--tear-radius', '--foreground-width', '--foreground-scale', 'height']) this.node.style.removeProperty(property);
  }
}
