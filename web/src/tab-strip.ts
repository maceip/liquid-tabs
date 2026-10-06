import { advanceSpring, clamp, destination, geometry, layoutTabs } from './geometry.ts';
import type { WidthLock } from './geometry.ts';
import { GlassLens } from './glass.ts';
import { TearOffPreview } from './tear-off.ts';
import type { PreviewRect } from './tear-off.ts';
import { iconMarkup, symbol } from './icons.ts';
import { fullEffects } from './types.ts';
import { createTabId } from './identity.ts';
import { tabLabel } from './presentation.ts';
import { TabHoverPreview } from './hover-preview.ts';
import type { Axis, Effects, Layout, Tab, TabStripOptions, TabLabelMode, TabHoverOptions } from './types.ts';
import './tabs.css';

interface Cell {
  node: HTMLDivElement; activate: HTMLButtonElement; icon: HTMLElement; title: HTMLElement; address: HTMLInputElement;
  close: HTMLButtonElement; reload: HTMLButtonElement; actions: HTMLButtonElement;
  x: Axis; width: Axis; drawnX: number; drawnWidth: number;
}
interface Press { id: string; pointer: number; startX: number; startY: number; fraction: number; grabY: number; wasSelected: boolean }
interface Drag {
  id: string; phase: 'dragging' | 'detached' | 'opening' | 'settling'; order: string[]; fraction: number;
  cursor: number; cursorY: number; began: number; lock: WidthLock; grabY: number; horizontal: boolean;
  inlineWidth: number; flight?: TearOffPreview; recenterBegan?: number;
  settleFrom?: PreviewRect; settleBlend?: number; resumeScroll?: number;
}
const axis = (value: number): Axis => ({ value, target: value, velocity: 0 });
const stationary = (a: Axis) => a.value === a.target && a.velocity === 0;
const assign = (a: Axis, value: number) => { a.value = a.target = value; a.velocity = 0; };
const fallbackTab = (): Tab => ({ id: createTabId(), title: 'New Tab', address: '', icon: { glyph: 'P', background: '#526941', color: '#fff' } });

/** Framework-independent DOM component. Tab and page identity survive every
 * reorder. One rAF loop owns geometry; no overlay replacement occurs on drop. */
export class TabStrip {
  readonly root: HTMLElement;
  private options: TabStripOptions;
  private tabs: Tab[];
  private selected: string;
  private labelMode: TabLabelMode;
  private hover: TabHoverPreview;
  private effects: Effects;
  private stage: HTMLDivElement;
  private track: HTMLDivElement;
  private live: HTMLDivElement;
  private cells = new Map<string, Cell>();
  private resize: ResizeObserver;
  private abort = new AbortController();
  private lens = new GlassLens();
  private layout: Layout = { slots: [], pins: 0, normalOrigin: 0, normalWidth: 0, maxScroll: 0 };
  private available = 0;
  private left = 0;
  private top = 0;
  private scroll = 0;
  private inside = false;
  private widthLock?: WidthLock;
  private press?: Press;
  private drag?: Drag;
  private menu?: HTMLDivElement;
  private menuAnchor?: HTMLElement;
  private frame: number | null = null;
  private inFrame = false;
  private lastTime = 0;
  private dark = true;
  private destroyed = false;
  private frameCosts: number[] = [];
  private mutation = 0;
  private detaching?: AbortController;

  constructor(root: HTMLElement, options: TabStripOptions) {
    this.root = root; this.options = options;
    this.labelMode = options.labelMode ?? 'fixed';
    this.tabs = this.normalize(options.tabs.length ? options.tabs : [fallbackTab()]);
    this.selected = options.selectedId && this.tabs.some(t => t.id === options.selectedId) ? options.selectedId : this.tabs[0].id;
    this.effects = { ...fullEffects, ...options.effects };
    root.classList.add('pie-tab-strip');
    root.innerHTML = `<div class="tab-stage" role="tablist" aria-label="Workspace tabs"><div class="tab-track" aria-hidden="true"></div></div>
      <button class="add-tab" type="button" aria-label="New tab" title="New tab">${symbol('plus')}</button><div class="tab-announcer" aria-live="polite"></div>`;
    this.stage = root.querySelector('.tab-stage')!; this.track = root.querySelector('.tab-track')!; this.live = root.querySelector('.tab-announcer')!;
    root.dataset.labelMode = this.labelMode;
    this.hover = new TabHoverPreview(root, options.hoverPreview, id => this.tabs.find(t => t.id === id),
      () => !this.destroyed && !this.drag && !this.press && !this.menu && !document.hidden &&
        ![...this.cells.values()].some(cell => document.activeElement === cell.address));
    const signal = this.abort.signal;
    root.querySelector('.add-tab')!.addEventListener('click', () => this.add(), { signal });
    this.stage.addEventListener('pointerdown', this.pointerDown, { signal });
    this.stage.addEventListener('pointermove', this.pointerMove, { signal });
    this.stage.addEventListener('pointerup', this.pointerUp, { signal });
    this.stage.addEventListener('pointercancel', () => this.returnDrag(true), { signal });
    this.stage.addEventListener('lostpointercapture', () => { if (this.press) this.returnDrag(true); }, { signal });
    root.addEventListener('pointerenter', () => { this.inside = true; }, { signal });
    root.addEventListener('pointerleave', () => {
      this.inside = false;
      if (this.widthLock) { this.widthLock = undefined; this.compute(); this.schedule(); }
    }, { signal });
    this.stage.addEventListener('wheel', this.wheel, { signal, passive: false });
    this.stage.addEventListener('contextmenu', this.contextMenu, { signal });
    this.stage.addEventListener('keydown', this.keyDown, { signal });
    document.addEventListener('pointerdown', event => {
      this.hover.hide();
      root.dataset.keyboard = 'false';
      if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
      for (const cell of this.cells.values()) if (document.activeElement === cell.address && !cell.node.contains(event.target as Node)) cell.address.blur();
    }, { signal, capture: true });
    document.addEventListener('keydown', event => {
      this.hover.hide();
      root.dataset.keyboard = 'true';
      if (event.key === 'Escape') {
        this.closeMenu(true);
        this.detaching?.abort();
        this.detaching = undefined;
        this.returnDrag(true);
      }
    }, { signal });
    window.addEventListener('blur', () => { this.hover.hide(); if (!this.detaching) this.returnDrag(true); this.closeMenu(); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.hover.hide(); if (!this.detaching) this.cancelDrag(); } }, { signal });
    window.addEventListener('scroll', () => { this.hover.hide(); this.readOrigin(); }, { signal, capture: true });
    this.syncCells();
    this.available = this.stage.clientWidth; this.readOrigin();
    this.compute(); this.paintImmediately(); this.setEffects(this.effects);
    this.resize = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - this.available) < 0.1) return;
      this.hover.hide();
      this.cancelDrag(); this.widthLock = undefined;
      this.available = width; this.readOrigin();
      this.compute(); this.reveal(this.selected); this.schedule();
    });
    this.resize.observe(this.stage);
    this.options.onChange?.(this.items); this.options.onSelect?.(this.current);
  }

  /** Defensive copy — hosts must not mutate library-owned tab objects. */
  get current(): Tab { return { ...this.tabs.find(t => t.id === this.selected)! }; }
  get configuration(): Effects { return { ...this.effects }; }
  get items(): readonly Tab[] { return this.tabs.map(t => ({ ...t })); }
  get size(): number { return this.tabs.length; }
  get selectedId(): string { return this.selected; }
  get isDragging(): boolean { return !!this.drag; }
  get theme(): 'dark' | 'light' { return this.dark ? 'dark' : 'light'; }
  get labelModeValue(): TabLabelMode { return this.labelMode; }

  indexOf(id: string): number { return this.tabs.findIndex(t => t.id === id); }
  getTab(id: string): Tab | undefined {
    const tab = this.tabs.find(t => t.id === id);
    return tab ? { ...tab } : undefined;
  }

  /** Invoke from a trusted click for a menu/API detach. No window is opened by
   * the component itself; the host's synchronous callback owns that policy. */
  detach(id: string, point = { screenX: window.screenX + window.outerWidth / 2, screenY: window.screenY + 100 },
    trigger: 'drag' | 'menu' | 'api' = 'api'): Promise<boolean> {
    const tab = this.tabs.find(t => t.id === id), handler = this.options.onDetach;
    if (!tab || this.tabs.length < 2 || !handler || this.detaching) return Promise.resolve(false);
    const controller = new AbortController(); this.detaching = controller;
    if (this.drag?.id === id) this.drag.phase = 'opening';
    // Do not await or schedule before invoking the host: opening a browser
    // window must use the current trusted input event's user activation.
    let result: boolean | Promise<boolean>;
    try { result = handler({ tab: { ...tab }, ...point, trigger, signal: controller.signal }); }
    catch { result = false; }
    return Promise.resolve(result).catch(() => false).then(accepted => {
      if (this.detaching !== controller || this.destroyed) return false;
      this.detaching = undefined;
      if (accepted && !controller.signal.aborted) {
        this.cancelDrag(); this.inside = false; this.widthLock = undefined;
        this.close(id, true); this.paintImmediately();
        this.announce(`${tab.title} moved to a new window`); return true;
      }
      if (this.drag?.phase === 'opening') this.drag.phase = 'detached';
      this.returnDrag(false); this.announce(`${tab.title} remains in this window`); return false;
    });
  }

  private normalize(tabs: readonly Tab[]): Tab[] {
    if (new Set(tabs.map(t => t.id)).size !== tabs.length) throw new Error('Tab IDs must be unique');
    return [...tabs.filter(t => t.pinned), ...tabs.filter(t => !t.pinned)].map(t => ({ ...t }));
  }

  setTabs(tabs: Tab[], selectedId?: string): void {
    this.hover.hide();
    this.cancelDrag(); this.closeMenu(); this.widthLock = undefined; this.scroll = 0;
    this.tabs = this.normalize(tabs.length ? tabs : [fallbackTab()]);
    this.selected = selectedId && this.tabs.some(t => t.id === selectedId) ? selectedId : this.tabs[0].id;
    this.changed(true);
  }

  select(id: string, reveal = true): void {
    if (!this.cells.has(id) || id === this.selected) return;
    this.cells.get(this.selected)?.address.blur();
    this.selected = id; this.syncCells(); this.compute();
    if (reveal && !this.drag) this.reveal(id);
    this.schedule(); this.options.onSelect?.(this.current);
  }

  selectNext(reveal = true): void {
    const index = this.tabs.findIndex(t => t.id === this.selected);
    this.select(this.tabs[(index + 1) % this.tabs.length].id, reveal);
  }

  selectPrevious(reveal = true): void {
    const index = this.tabs.findIndex(t => t.id === this.selected);
    this.select(this.tabs[(index - 1 + this.tabs.length) % this.tabs.length].id, reveal);
  }

  selectFirst(reveal = true): void {
    if (this.tabs[0]) this.select(this.tabs[0].id, reveal);
  }

  selectLast(reveal = true): void {
    const last = this.tabs[this.tabs.length - 1];
    if (last) this.select(last.id, reveal);
  }

  /** Programmatic reorder with the same pin grouping as drag-and-drop. */
  move(id: string, index: number): void {
    const from = this.tabs.findIndex(t => t.id === id);
    if (from < 0) return;
    this.cancelDrag(); this.widthLock = undefined;
    const [tab] = this.tabs.splice(from, 1);
    const pins = this.tabs.filter(t => t.pinned).length;
    const clamped = Math.max(0, Math.min(index, this.tabs.length));
    const destination = tab.pinned ? Math.min(clamped, pins) : Math.max(clamped, pins);
    this.tabs.splice(Math.min(destination, this.tabs.length), 0, tab);
    this.changed(false); this.reveal(id);
    this.options.onMove?.(id, this.tabs.findIndex(t => t.id === id));
    this.announce(`${tab.title} moved`);
  }

  add(tab = this.options.onNewTab?.() ?? fallbackTab()): void {
    this.finishSettle(); this.cancelDrag(); this.widthLock = undefined;
    if (this.tabs.some(t => t.id === tab.id)) throw new Error('Tab IDs must be unique');
    const pins = this.tabs.filter(t => t.pinned).length;
    const index = tab.pinned ? pins : Math.max(pins, this.tabs.findIndex(t => t.id === this.selected) + 1);
    const previous = this.cells.get(this.selected);
    const origin = previous ? previous.x.value + previous.width.value : 0;
    this.tabs.splice(index, 0, { ...tab }); this.selected = tab.id;
    this.syncCells(); this.compute();
    const cell = this.cells.get(tab.id)!;
    assign(cell.x, origin); assign(cell.width, 0.01);
    this.compute(); this.reveal(tab.id); this.changed(true);
    if (this.labelMode === 'address' && !tab.address) cell.address.focus({ preventScroll: true });
    this.announce('New tab');
  }

  close(id: string, explicit = false): void {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    if (tab.pinned && !explicit) {
      const normal = this.tabs.find(t => !t.pinned);
      if (normal) this.select(normal.id); else this.add();
      return;
    }
    this.cancelDrag();
    const hadFocus = this.cells.get(id)?.node.contains(document.activeElement);
    if (this.inside && !tab.pinned) this.widthLock ??= this.captureWidths();
    else this.widthLock = undefined;
    this.tabs.splice(index, 1);
    if (!this.tabs.length) this.tabs = [this.options.onNewTab?.() ?? fallbackTab()];
    const selectionChanged = this.selected === id;
    if (selectionChanged) this.selected = this.tabs[Math.min(index, this.tabs.length - 1)].id;
    this.changed(selectionChanged);
    if (hadFocus) this.cells.get(this.selected)?.activate.focus({ preventScroll: true });
    this.options.onClose?.(id);
    this.announce(`${tab.title} closed`);
  }

  pin(id: string, pinned = !this.tabs.find(t => t.id === id)?.pinned): void {
    this.cancelDrag(); this.widthLock = undefined;
    const index = this.tabs.findIndex(t => t.id === id);
    if (index < 0 || !!this.tabs[index].pinned === pinned) return;
    const [tab] = this.tabs.splice(index, 1); tab.pinned = pinned;
    this.tabs.splice(this.tabs.filter(t => t.pinned).length, 0, tab);
    this.changed(false); this.reveal(id);
    this.options.onPinChange?.(id, pinned);
    this.announce(`${tab.title} ${pinned ? 'pinned' : 'unpinned'}`);
  }

  /** Toggle pin state for the given tab. */
  togglePin(id: string): void {
    const tab = this.tabs.find(t => t.id === id);
    if (tab) this.pin(id, !tab.pinned);
  }

  update(id: string, update: Partial<Pick<Tab, 'title' | 'address' | 'icon' | 'hoverContent'>>): void {
    const tab = this.tabs.find(t => t.id === id);
    if (tab) { Object.assign(tab, update); this.changed(false); }
  }

  setEffects(effects: Partial<Effects>): void {
    this.effects = { ...this.effects, ...effects };
    for (const name of ['glass', 'refraction', 'blur', 'shadows'] as const) this.root.dataset[name] = String(this.effects[name]);
    this.root.dataset.motion = this.effects.motion;
    this.schedule();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.dark = theme === 'dark'; this.root.dataset.theme = theme; this.schedule();
  }

  setLabelMode(mode: TabLabelMode): void {
    if (mode === this.labelMode) return;
    this.hover.hide(); this.cancelDrag(); this.widthLock = undefined;
    for (const cell of this.cells.values()) cell.address.blur();
    this.labelMode = mode; this.options.labelMode = mode; this.root.dataset.labelMode = mode;
    this.syncCells(); this.compute(); this.schedule();
  }

  setHoverPreview(options: false | TabHoverOptions): void {
    this.options.hoverPreview = options; this.hover.setOptions(options);
  }

  private changed(selectionChanged: boolean): void {
    this.mutation++; this.syncCells(); this.compute(); this.schedule();
    this.options.onChange?.(this.items);
    if (selectionChanged) this.options.onSelect?.(this.current);
  }

  private syncCells(): void {
    for (const [id, cell] of this.cells) if (!this.tabs.some(t => t.id === id)) {
      this.hover.leave(cell.node);
      cell.node.remove(); this.cells.delete(id);
    }
    this.root.dataset.single = String(this.tabs.length === 1);
    for (const tab of this.tabs) {
      let cell = this.cells.get(tab.id);
      if (!cell) {
        const node = document.createElement('div');
        node.className = 'pie-tab'; node.dataset.tabId = tab.id;
        node.innerHTML = `<div class="tab-surface" aria-hidden="true"></div><div class="tab-focus-ring" aria-hidden="true"></div>
          <div class="tab-foreground">
          <button type="button" class="tab-activate" role="tab"><span class="tab-label"><span class="tab-icon" aria-hidden="true"></span><span class="tab-title"></span></span></button>
          <button type="button" class="tab-close" aria-label="Close tab" title="Close tab">${symbol('close')}</button>
          <input class="tab-address" type="text" spellcheck="false" autocomplete="off" aria-label="Tab address and search" placeholder="Search or enter an address" tabindex="-1" />
          <button type="button" class="tab-reload" aria-label="Reload tab" title="Reload">${symbol('reload')}</button>
          <button type="button" class="tab-actions" aria-label="Tab actions" title="Tab actions">${symbol('actions')}</button></div>`;
        const close = node.querySelector<HTMLButtonElement>('.tab-close')!;
        const actions = node.querySelector<HTMLButtonElement>('.tab-actions')!;
        const reload = node.querySelector<HTMLButtonElement>('.tab-reload')!;
        const address = node.querySelector<HTMLInputElement>('.tab-address')!;
        const activate = node.querySelector<HTMLButtonElement>('.tab-activate')!;
        activate.id = `tab-${tab.id}`;
        const signal = this.abort.signal;
        const hover = (event: PointerEvent) => {
          if ((event.target as HTMLElement).closest('button:not(.tab-activate),input')) this.hover.hide();
          else this.hover.move(node, tab.id, event);
        };
        node.addEventListener('pointerenter', hover, { signal });
        node.addEventListener('pointermove', hover, { signal });
        node.addEventListener('pointerleave', () => this.hover.leave(node), { signal });
        node.addEventListener('click', event => {
          // Accessibility activation emits a click without a pointer sequence.
          if (!this.drag && !(event.target as HTMLElement).closest('button:not(.tab-activate),input')) this.select(tab.id);
        }, { signal });
        close.addEventListener('click', e => { e.stopPropagation(); this.close(tab.id); }, { signal });
        actions.addEventListener('click', () => {
          const rect = actions.getBoundingClientRect(); this.showMenu(tab.id, rect.right, rect.bottom + 5, actions);
        }, { signal });
        reload.addEventListener('click', () => {
          if (this.effects.motion !== 'off') reload.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 380 });
          const reloaded = this.tabs.find(t => t.id === tab.id);
          if (reloaded) this.options.onReload?.({ ...reloaded });
          this.announce(`${reloaded?.title} refreshed`);
        }, { signal });
        address.addEventListener('focus', () => {
          if (this.labelMode !== 'address') { address.blur(); return; }
          this.hover.hide();
          node.classList.add('editing'); address.value = this.tabs.find(t => t.id === tab.id)?.address ?? '';
          address.setSelectionRange(address.value.length, address.value.length);
        }, { signal });
        address.addEventListener('blur', () => { node.classList.remove('editing'); }, { signal });
        address.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const current = this.tabs.find(t => t.id === tab.id)!;
            this.options.onNavigate?.(current, address.value.trim()); address.blur();
          } else if (e.key === 'Escape') { address.blur(); activate.focus({ preventScroll: true }); }
          e.stopPropagation();
        }, { signal });
        this.stage.append(node);
        cell = { node, activate, close, actions, reload, address, icon: node.querySelector('.tab-icon')!, title: node.querySelector('.tab-title')!,
          x: axis(0), width: axis(0), drawnX: NaN, drawnWidth: NaN };
        this.cells.set(tab.id, cell);
      }
      const selected = tab.id === this.selected;
      cell.node.dataset.selected = String(selected); cell.node.dataset.pinned = String(!!tab.pinned);
      const next = this.tabs[this.tabs.indexOf(tab) + 1];
      cell.node.dataset.separator = String(!tab.pinned && !!next && !next.pinned && next.id !== this.selected);
      cell.node.dataset.empty = String(this.labelMode === 'address' && !tab.address); cell.activate.tabIndex = selected ? 0 : -1;
      cell.activate.setAttribute('aria-selected', String(selected));
      cell.activate.setAttribute('aria-label', `${tab.title}${tab.pinned ? ', pinned' : ''}`);
      cell.activate.setAttribute('aria-controls', `panel-${tab.id}`);
      cell.node.removeAttribute('title');
      cell.icon.innerHTML = selected && this.labelMode === 'address' && !tab.address ? symbol('search') : iconMarkup(tab.icon);
      cell.title.textContent = tabLabel(tab, selected, this.labelMode);
      cell.close.hidden = !!tab.pinned || this.tabs.length === 1;
      cell.actions.hidden = !selected || (this.labelMode === 'address' && !tab.address);
      cell.reload.hidden = !selected || !tab.address;
      // Keep hidden chrome out of the tab order on inactive tabs.
      cell.close.tabIndex = cell.close.hidden ? -1 : 0;
      cell.actions.tabIndex = cell.actions.hidden ? -1 : 0;
      cell.reload.tabIndex = cell.reload.hidden ? -1 : 0;
      const editable = selected && this.labelMode === 'address';
      cell.address.tabIndex = editable ? 0 : -1;
      cell.address.hidden = !editable; cell.address.disabled = !editable;
      if (!editable && document.activeElement === cell.address) cell.address.blur();
    }
    this.hover.refresh();
  }

  private ordered(): Tab[] {
    return this.drag ? this.drag.order.filter(id => !['detached', 'opening'].includes(this.drag!.phase) || id !== this.drag!.id)
      .map(id => this.tabs.find(t => t.id === id)!).filter(Boolean) : this.tabs;
  }
  private readOrigin(): void { const bounds = this.stage.getBoundingClientRect(); this.left = bounds.left; this.top = bounds.top; }
  private compute(): void {
    this.layout = layoutTabs(this.ordered(), this.selected, this.available, this.drag && ['detached', 'opening'].includes(this.drag.phase) ? undefined : this.drag?.lock ?? this.widthLock, this.labelMode);
    this.scroll = clamp(this.scroll, 0, this.layout.maxScroll);
    for (const slot of this.layout.slots) {
      const cell = this.cells.get(slot.id)!;
      const target = slot.x - (slot.pinned ? 0 : this.scroll);
      // Native CASpringAnimation restarts from its presentation position with
      // zero initial velocity when a neighboring slot changes direction.
      if (this.drag && target !== cell.x.target) cell.x.velocity = 0;
      cell.x.target = target; cell.width.target = slot.width;
      if (cell.width.value === 0) { assign(cell.width, slot.width); assign(cell.x, cell.x.target); }
    }
  }
  private captureWidths(): WidthLock {
    const normalSlots = this.layout.slots.filter(s => !s.pinned);
    return { widths: new Map(this.layout.slots.map(s => [s.id, s.width])), origin: this.layout.normalOrigin,
      gap: normalSlots.length > 1 ? normalSlots[1].x - normalSlots[0].x - normalSlots[0].width : 0,
      extent: this.layout.normalWidth + this.layout.normalOrigin };
  }
  private reveal(id: string): void {
    const slot = this.layout.slots.find(s => s.id === id);
    if (!slot || slot.pinned) return;
    if (slot.x - this.scroll < this.layout.pins) this.scroll = slot.x - this.layout.pins;
    if (slot.x + slot.width - this.scroll > this.available) this.scroll = slot.x + slot.width - this.available;
    this.compute(); this.schedule();
  }
  private schedule(): void {
    if (this.destroyed || this.inFrame || this.frame !== null) return;
    this.lastTime = performance.now(); this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number): void => {
    this.frame = null;
    this.inFrame = true;
    const started = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000)); this.lastTime = now;
    if (this.drag?.phase === 'dragging') {
      if (!this.tabs.find(t => t.id === this.drag!.id)?.pinned && this.layout.maxScroll > 0) {
        const local = this.drag.cursor - this.left;
        const speed = local > this.available - 32 ? 320 : (local < this.layout.pins + 32 ? -320 : 0);
        const next = clamp(this.scroll + speed * dt, 0, this.layout.maxScroll);
        if (next !== this.scroll) { this.scroll = next; this.compute(); this.updateSlot(); }
      }
    }
    let moving = false;
    for (const [id, cell] of this.cells) {
      const held = this.drag?.id === id && this.drag.phase !== 'settling';
      const settling = this.drag?.id === id && this.drag.phase === 'settling';
      if (this.drag?.id === id && this.drag.flight) continue;
      if (this.effects.motion === 'off' || (this.effects.motion === 'reduced' && !held)) {
        assign(cell.x, cell.x.target); assign(cell.width, cell.width.target);
      } else {
        if (!held) advanceSpring(cell.x, dt, settling ? 30 : undefined, settling ? 1 : undefined);
        advanceSpring(cell.width, dt, settling ? 30 : undefined, settling ? 1 : undefined);
      }
      if (held) { cell.x.value = this.drag!.cursor - this.left - cell.width.value * this.drag!.fraction; cell.x.velocity = 0; }
      moving ||= !stationary(cell.x) || !stationary(cell.width);
    }
    this.paintFlight(now);
    if (this.drag?.phase === 'settling' && (now - this.drag.began >= 300 || this.effects.motion !== 'full')) this.finishSettle();
    this.paint();
    this.frameCosts.push(performance.now() - started);
    if (this.frameCosts.length > 360) this.frameCosts.shift();
    this.inFrame = false;
    if (moving || this.drag) this.frame = requestAnimationFrame(this.tick);
  };

  private paintImmediately(): void {
    for (const cell of this.cells.values()) { assign(cell.x, cell.x.target); assign(cell.width, cell.width.target); }
    this.paint();
  }
  private paint(): void {
    const left = Math.max(this.layout.pins, this.layout.pins + this.layout.normalOrigin - this.scroll);
    const right = Math.min(this.available, this.layout.pins + this.layout.normalOrigin + this.layout.normalWidth - this.scroll);
    this.track.style.transform = `translateX(${left}px)`; this.track.style.width = `${Math.max(0, right - left)}px`;
    for (const [id, cell] of this.cells) {
      if (this.drag?.id === id && this.drag.flight) continue;
      const { value: x } = cell.x, { value: width } = cell.width;
      if (x !== cell.drawnX) { cell.node.style.transform = `translate3d(${x}px,0,0)`; cell.drawnX = x; }
      if (width !== cell.drawnWidth) { cell.node.style.width = `${Math.max(0.01, width)}px`; cell.drawnWidth = width; }
      const pin = this.tabs.find(t => t.id === id)?.pinned;
      const raised = this.drag?.id === id;
      const clipLeft = raised || pin ? 0 : Math.max(0, this.layout.pins - x);
      const clipRight = raised ? 0 : Math.max(0, x + width - this.available);
      cell.node.style.clipPath = clipLeft || clipRight ? `inset(-30px ${clipRight}px -30px ${clipLeft}px)` : '';
      cell.node.style.pointerEvents = width < 1 || clipLeft + clipRight >= width ? 'none' : '';
      cell.node.dataset.clipped = String(clipLeft + clipRight >= width);
    }
    if (this.drag) {
      const cell = this.cells.get(this.drag.id)!;
      this.lens.render(this.tabs.filter(t => t.id !== this.drag!.id).map(tab => {
        const c = this.cells.get(tab.id)!;
        return { tab, x: c.x.value, width: c.width.value, selected: tab.id === this.selected };
      }), cell.x.value, cell.width.value, this.effects, this.dark, this.labelMode);
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.detaching) return;
    if (this.drag?.flight && this.drag.phase === 'settling') return;
    const target = event.target as HTMLElement;
    if (target.closest('button:not(.tab-activate)') || target.matches('input')) return;
    const node = target.closest<HTMLElement>('[data-tab-id]');
    if (!node) return;
    this.closeMenu(); this.finishSettle(true);
    const id = node.dataset.tabId!; const cell = this.cells.get(id)!;
    cell.address.blur(); this.readOrigin();
    this.press = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
      fraction: clamp((event.clientX - this.left - cell.x.value) / cell.width.value, 0, 1),
      grabY: clamp((event.clientY - this.top) / 36, 0, 1), wasSelected: id === this.selected };
    this.select(id, false);
    this.stage.setPointerCapture(event.pointerId);
    cell.activate.focus({ preventScroll: true }); event.preventDefault();
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.press || event.pointerId !== this.press.pointer || this.tabs.length < 2) return;
    if (!this.drag && Math.hypot(event.clientX - this.press.startX, event.clientY - this.press.startY) < geometry.threshold) return;
    if (!this.drag) {
      const cell = this.cells.get(this.press.id)!;
      cell.address.blur(); this.widthLock = undefined;
      this.drag = { id: this.press.id, phase: 'dragging', order: this.tabs.map(t => t.id),
        fraction: this.press.fraction, grabY: this.press.grabY, cursor: event.clientX, cursorY: event.clientY,
        horizontal: Math.abs(event.clientX - this.press.startX) >= Math.abs(event.clientY - this.press.startY),
        inlineWidth: cell.width.target, began: performance.now(), lock: this.captureWidths() };
      cell.node.classList.add('lifted'); this.root.classList.add('is-dragging');
      cell.node.prepend(this.lens.element);
      if (!this.drag.horizontal) this.beginFlight(performance.now());
    }
    this.moveDrag(event.clientX, event.clientY); this.schedule(); event.preventDefault();
  };
  private beginFlight(now: number): void {
    const drag = this.drag!;
    if (drag.flight) return;
    const cell = this.cells.get(drag.id)!;
    const dragged = this.tabs.find(t => t.id === drag.id) ?? this.current;
    const source = this.options.previewContent?.(dragged) ?? document.getElementById(`panel-${drag.id}`);
    // A clipped, overflowing source tab still needs its complete lifted face.
    cell.node.style.clipPath = ''; cell.node.style.pointerEvents = '';
    drag.flight = new TearOffPreview(cell.node, source, { x: this.left + cell.x.value, y: this.top, width: cell.width.value, height: 36 });
    drag.recenterBegan = now;
  }
  private moveDrag(x: number, y: number): void {
    const drag = this.drag;
    if (!drag || drag.phase === 'settling') return;
    drag.cursor = x; drag.cursorY = y;
    const band = drag.horizontal && !drag.flight ? 100 : 0;
    const attached = x >= this.left && x <= this.left + this.available && y >= this.top - band && y <= this.top + 36 + band;
    if (attached !== (drag.phase === 'dragging')) {
      const now = performance.now();
      if (!attached) { drag.resumeScroll = this.scroll; this.beginFlight(now); }
      else if (drag.resumeScroll !== undefined) this.scroll = drag.resumeScroll;
      drag.phase = attached ? 'dragging' : 'detached';
      drag.flight?.setDetached(!attached, now);
      this.cells.get(drag.id)!.node.dataset.flight = drag.phase;
      this.compute();
    }
    // Resolve the virtual slot at the input event, as the native strip does.
    // The following rAF only advances presentation springs and optical sampling.
    if (attached) this.updateSlot();
  }
  private grabFraction(now: number): number {
    const drag = this.drag!;
    if (drag.recenterBegan === undefined) return drag.fraction;
    const t = clamp((now - drag.recenterBegan) / 120, 0, 1);
    return drag.fraction + (0.5 - drag.fraction) * (1 - (1 - t) ** 3);
  }
  private paintFlight(now: number): void {
    const drag = this.drag, flight = drag?.flight;
    if (!drag || !flight) return;
    let rect: PreviewRect;
    const cell = this.cells.get(drag.id)!;
    if (drag.phase === 'settling' && drag.settleFrom) {
      const phase = Math.max(0, (now - drag.began) / 1000) * 30;
      const progress = this.effects.motion === 'full' ? 1 - (1 + phase) * Math.exp(-phase) : 1;
      const from = drag.settleFrom;
      const mix = (a: number, b: number) => a + (b - a) * progress;
      rect = { x: mix(from.x, this.left + cell.x.target), y: mix(from.y, this.top),
        width: mix(from.width, cell.width.target), height: mix(from.height, 36) };
      flight.blend = (drag.settleBlend ?? 0) * (1 - progress);
    } else {
      flight.advance(now, this.effects.motion === 'full');
      const blend = flight.blend;
      const width = drag.inlineWidth + (flight.thumbnail.width - drag.inlineWidth) * blend;
      const height = 36 + (flight.thumbnail.height - 36) * blend;
      const inlineY = drag.horizontal ? this.top : drag.cursorY - 36 * drag.grabY;
      const freeY = drag.cursorY - height * drag.grabY;
      rect = { x: drag.cursor - width * this.grabFraction(now), y: inlineY + (freeY - inlineY) * blend, width, height };
    }
    flight.paint(rect, drag.inlineWidth);
    cell.x.value = rect.x - this.left; cell.width.value = rect.width;
  }
  private updateSlot(): void {
    const drag = this.drag;
    if (!drag || drag.phase !== 'dragging') return;
    const tab = this.tabs.find(t => t.id === drag.id)!;
    const group = this.layout.slots.filter(s => s.pinned === !!tab.pinned).map(s => ({ ...s, x: s.x - (s.pinned ? 0 : this.scroll) }));
    const localIndex = group.findIndex(s => s.id === drag.id);
    // Thresholds use the reserved slot width, just like the native strip;
    // an activating tab's animated width must not move the crossing boundary.
    const center = drag.cursor - this.left + (0.5 - this.grabFraction(performance.now())) * drag.inlineWidth;
    const next = destination(center, localIndex, group);
    if (next === localIndex) return;
    const groupOffset = tab.pinned ? 0 : this.tabs.filter(t => t.pinned).length;
    drag.order.splice(drag.order.indexOf(drag.id), 1); drag.order.splice(groupOffset + next, 0, drag.id);
    this.compute();
  }
  private pointerUp = (event: PointerEvent): void => {
    if (!this.press || event.pointerId !== this.press.pointer) return;
    const press = this.press;
    if (!this.drag) {
      this.press = undefined;
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
      if (press.wasSelected && this.labelMode === 'address') this.cells.get(press.id)?.address.focus({ preventScroll: true });
      return;
    }
    this.moveDrag(event.clientX, event.clientY);
    if (this.drag.phase === 'detached' && this.options.onDetach) {
      this.press = undefined;
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
      void this.detach(this.drag.id, { screenX: event.screenX, screenY: event.screenY }, 'drag');
    } else this.returnDrag(false);
  };
  private returnDrag(cancelled: boolean): void {
    const pointer = this.press?.pointer; this.press = undefined;
    if (pointer !== undefined && this.stage.hasPointerCapture(pointer)) this.stage.releasePointerCapture(pointer);
    const drag = this.drag;
    if (!drag || drag.phase === 'settling') return;
    if (cancelled) drag.order = this.tabs.map(t => t.id);
    const now = performance.now(), cell = this.cells.get(drag.id)!;
    if (drag.flight) {
      this.paintFlight(now);
      drag.settleFrom = { ...drag.flight.rect }; drag.settleBlend = drag.flight.blend;
      drag.flight.setDetached(false, now);
    } else cell.x.value = drag.cursor - this.left - cell.width.value * drag.fraction;
    if (drag.phase === 'detached' && drag.resumeScroll !== undefined) this.scroll = drag.resumeScroll;
    cell.x.velocity = 0; drag.phase = 'settling'; drag.began = now;
    cell.node.dataset.flight = 'settling';
    this.compute(); this.schedule();
  }
  private finishSettle(preservePosition = false): void {
    if (!this.drag || this.drag.phase !== 'settling') return;
    const { id, order } = this.drag;
    const cell = this.cells.get(id)!;
    this.drag.flight?.destroy();
    delete cell.node.dataset.flight;
    cell.drawnX = cell.drawnWidth = NaN;
    if (!preservePosition) { assign(cell.x, cell.x.target); assign(cell.width, cell.width.target); }
    this.tabs = order
      .map(tabId => this.tabs.find(t => t.id === tabId))
      .filter((t): t is Tab => !!t);
    this.drag = undefined; cell.node.classList.remove('lifted'); this.root.classList.remove('is-dragging'); this.lens.clear();
    this.changed(false); this.paint();
    const settled = this.tabs.find(t => t.id === id);
    if (settled) this.announce(`${settled.title}, tab ${this.tabs.findIndex(t => t.id === id) + 1} of ${this.tabs.length}`);
  }
  private cancelDrag(): void {
    this.detaching?.abort(); this.detaching = undefined;
    const pointer = this.press?.pointer; this.press = undefined;
    if (pointer !== undefined && this.stage.hasPointerCapture(pointer)) this.stage.releasePointerCapture(pointer);
    if (this.drag) {
      const cell = this.cells.get(this.drag.id);
      this.drag.flight?.destroy();
      if (cell) { cell.node.classList.remove('lifted'); delete cell.node.dataset.flight; cell.drawnX = cell.drawnWidth = NaN; }
      this.drag = undefined; this.root.classList.remove('is-dragging'); this.lens.clear();
      this.compute(); this.schedule();
    }
  }
  private wheel = (event: WheelEvent): void => {
    if (!this.layout.maxScroll || this.drag) return;
    this.scroll = clamp(this.scroll + (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY), 0, this.layout.maxScroll);
    this.compute(); this.paintImmediately(); event.preventDefault();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).matches('input')) return;
    const index = this.tabs.findIndex(t => t.id === this.selected);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % this.tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + this.tabs.length) % this.tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.tabs.length - 1;
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      // Close button is hidden for the sole tab — keep keyboard consistent.
      if (this.tabs.length > 1) this.close(this.selected);
      event.preventDefault(); return;
    }
    else if (event.key === 'F2' && this.labelMode === 'address') { this.cells.get(this.selected)?.address.focus({ preventScroll: true }); event.preventDefault(); return; }
    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const node = this.cells.get(this.selected)!.activate, rect = node.getBoundingClientRect();
      this.showMenu(this.selected, rect.left + 12, rect.bottom + 4, node); event.preventDefault(); return;
    } else return;
    event.preventDefault(); this.cancelDrag();
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && next !== index) {
      const tab = this.tabs[index], neighbor = this.tabs[next];
      if (!!tab.pinned === !!neighbor.pinned) {
        this.tabs.splice(index, 1); this.tabs.splice(next, 0, tab); this.changed(false);
      }
    } else this.select(this.tabs[next].id);
    this.cells.get(this.selected)?.activate.focus({ preventScroll: true });
  };

  private contextMenu = (event: MouseEvent): void => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
    if (!node || (event.target as HTMLElement).matches('input')) return;
    event.preventDefault(); this.showMenu(node.dataset.tabId!, event.clientX, event.clientY, this.cells.get(node.dataset.tabId!)!.activate);
  };
  private showMenu(id: string, x: number, y: number, anchor: HTMLElement): void {
    this.closeMenu(); this.cancelDrag();
    const tab = this.tabs.find(t => t.id === id)!;
    const menu = document.createElement('div'); menu.className = 'tab-menu'; menu.role = 'menu';
    menu.dataset.theme = this.dark ? 'dark' : 'light'; this.menu = menu; this.menuAnchor = anchor;
    const add = (label: string, action: () => void, icon?: string) => {
      const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem';
      button.innerHTML = `${icon ?? '<span></span>'}<span></span>`; button.lastElementChild!.textContent = label;
      button.addEventListener('click', () => { this.closeMenu(true); action(); }); menu.append(button);
    };
    add(tab.pinned ? 'Unpin Tab' : 'Pin Tab', () => this.pin(id), symbol('pin'));
    add('Duplicate Tab', () => this.add({ ...tab, id: createTabId(), pinned: false }));
    if (this.options.onDetach && this.tabs.length > 1) add('Move Tab to New Window', () => { void this.detach(id, undefined, 'menu'); });
    menu.append(document.createElement('hr'));
    add('Close Tab', () => this.close(id, true), symbol('close'));
    add('Close Other Tabs', () => {
      this.widthLock = undefined;
      this.tabs = this.tabs.filter(t => t.id === id || t.pinned); this.selected = id; this.changed(true);
    });
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      } else if (event.key === 'Tab') this.closeMenu(true);
    });
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(x, 8, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${clamp(y, 8, window.innerHeight - rect.height - 8)}px`;
    menu.querySelector('button')!.focus({ preventScroll: true });
  }
  private closeMenu(restore = false): void {
    this.menu?.remove(); this.menu = undefined;
    if (restore && this.menuAnchor?.isConnected) this.menuAnchor.focus({ preventScroll: true });
    this.menuAnchor = undefined;
  }
  private announce(message: string): void { this.live.textContent = message; }

  /** Read-only diagnostics for deterministic gesture tests and performance review. */
  snapshot() {
    const costs = [...this.frameCosts].sort((a, b) => a - b);
    return { selected: this.selected, order: this.tabs.map(t => t.id), visualOrder: this.drag?.order ?? this.tabs.map(t => t.id),
      phase: this.drag?.phase ?? 'idle', scroll: this.scroll, maxScroll: this.layout.maxScroll,
      running: this.frame !== null, mutation: this.mutation, effects: this.configuration,
      labelMode: this.labelMode, hoverPreview: this.hover.snapshot,
      frameCostP95: costs[Math.floor(costs.length * .95)] ?? 0,
      flight: this.drag?.flight ? { ...this.drag.flight.rect, blend: this.drag.flight.blend, target: this.drag.flight.target } : null,
      cells: [...this.cells].map(([id, c]) => ({ id, x: c.x.value, width: c.width.value, velocity: c.x.velocity, targetX: c.x.target, targetWidth: c.width.target })) };
  }
  destroy(): void {
    this.hover.destroy();
    this.destroyed = true; this.abort.abort(); this.resize.disconnect(); this.closeMenu(); this.cancelDrag();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.root.replaceChildren(); this.cells.clear();
  }
}
