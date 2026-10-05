import type { Tab, TabHoverOptions } from './types.ts';
import { createTabId } from './identity.ts';

/** A noninteractive caption below the tab, after the pointer stops moving. */
export class TabHoverPreview {
  private card: HTMLDivElement;
  private anchor?: HTMLElement;
  private id?: string;
  private point = { x: 0, y: 0 };
  private timer?: ReturnType<typeof setTimeout>;
  private visible = false;

  constructor(root: HTMLElement, private options: false | TabHoverOptions | undefined,
    private resolve: (id: string) => Tab | undefined, private canShow: () => boolean) {
    this.card = document.createElement('div');
    this.card.className = 'pie-tab-hover'; this.card.id = `tab-hover-${createTabId()}`;
    this.card.setAttribute('role', 'tooltip'); this.card.hidden = true;
    root.append(this.card);
  }

  get snapshot() { return { visible: this.visible, tabId: this.id ?? null }; }
  setOptions(options: false | TabHoverOptions | undefined): void { this.hide(); this.options = options; }

  move(anchor: HTMLElement, id: string, event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || this.options === false || !this.canShow()) { this.hide(); return; }
    if (this.anchor === anchor && Math.hypot(event.clientX - this.point.x, event.clientY - this.point.y) <= 2) return;
    this.hide(); this.anchor = anchor; this.id = id;
    this.point = { x: event.clientX, y: event.clientY };
    const delay = this.options?.delayMs ?? 650;
    this.timer = setTimeout(() => { this.timer = undefined; this.show(); }, Number.isFinite(delay) ? Math.max(0, delay) : 650);
  }

  leave(anchor: HTMLElement): void { if (this.anchor === anchor) this.hide(); }
  refresh(): void { if (this.visible) this.show(); }

  hide(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (typeof this.card.hidePopover === 'function' && this.card.matches(':popover-open')) this.card.hidePopover();
    this.card.removeAttribute('popover'); this.card.hidden = true;
    if (this.anchor) {
      const tab = this.anchor.querySelector('[role=tab]');
      const ids = tab?.getAttribute('aria-describedby')?.split(/\s+/).filter(id => id !== this.card.id);
      if (ids?.length) tab?.setAttribute('aria-describedby', ids.join(' ')); else tab?.removeAttribute('aria-describedby');
    }
    this.anchor = undefined; this.id = undefined; this.visible = false;
  }

  private show(): void {
    const tab = this.id ? this.resolve(this.id) : undefined;
    if (!tab || !this.anchor?.isConnected || this.options === false || !this.canShow()) { this.hide(); return; }
    const content = this.options?.content ? this.options.content(tab) : tab.hoverContent ?? {
      title: tab.title, subtitle: tab.address && tab.address !== tab.title ? tab.address : undefined,
    };
    if (!content) { this.hide(); return; }
    this.card.replaceChildren();
    for (const name of ['title', 'subtitle', 'detail'] as const) {
      const text = content[name];
      if (!text) continue;
      const line = document.createElement(name === 'title' ? 'strong' : 'span');
      line.className = `tab-hover-${name}`; line.textContent = text; this.card.append(line);
    }
    const desired = this.options?.maximumWidth ?? 280;
    const width = Math.min(Math.max(140, Number.isFinite(desired) ? desired : 280), Math.max(140, innerWidth - 16));
    this.card.style.width = `${width}px`; this.card.hidden = false;
    if (typeof this.card.showPopover === 'function') {
      this.card.setAttribute('popover', 'manual');
      if (!this.card.matches(':popover-open')) this.card.showPopover();
    }
    const rect = this.anchor.getBoundingClientRect(), height = this.card.getBoundingClientRect().height;
    const x = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    const below = rect.bottom + 8;
    const y = below + height <= innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
    this.card.style.left = `${x}px`; this.card.style.top = `${y}px`;
    const button = this.anchor.querySelector('[role=tab]');
    const descriptions = button?.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
    if (!descriptions.includes(this.card.id)) descriptions.push(this.card.id);
    button?.setAttribute('aria-describedby', descriptions.join(' ')); this.visible = true;
  }

  destroy(): void { this.hide(); this.card.remove(); }
}
