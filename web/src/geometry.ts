import type { Axis, Layout, Tab, TabLabelMode } from './types.ts';

export const geometry = { min: 120, max: 240, pin: 36, gap: 4, height: 36, threshold: 4, hysteresis: 10 } as const;
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Port of the native TabStripGeometry; keep both implementations calibrated.
export function restingWidths(available: number, count: number, selected: number, empty = false): number[] {
  if (!count) return [];
  if (count === 1) return [Math.min(280, Math.max(120, available))];
  if (count === 2 && empty) {
    const total = Math.min(520, Math.max(240, available));
    const active = Math.min(280, total - 120);
    return [0, 1].map(i => i === selected ? active : total - active);
  }
  if (count === 2) {
    const neighbor = clamp(available / 2, 120, 240);
    const active = Math.min(280, Math.max(neighbor, available - neighbor));
    return [0, 1].map(i => i === selected ? active : neighbor);
  }
  return Array(count).fill(clamp((available - (count - 1) * 4) / count, 120, 240));
}

export interface WidthLock { widths: Map<string, number>; origin: number; gap: number; extent: number }

export function layoutTabs(tabs: readonly Tab[], selected: string, available: number, lock?: WidthLock, mode: TabLabelMode = 'fixed'): Layout {
  const pins = tabs.filter(t => t.pinned);
  const normals = tabs.filter(t => !t.pinned);
  const selectedTab = tabs.find(t => t.id === selected);
  const empty = mode === 'address' && !selectedTab?.address;
  const natural = restingWidths(available, tabs.length, tabs.findIndex(t => t.id === selected), empty);
  let pinX = 0;
  const slots = pins.map(tab => {
    const width = tab.id === selected ? (natural[tabs.indexOf(tab)] ?? 240) : 36;
    const slot = { id: tab.id, x: pinX, width, pinned: true };
    pinX += width + 1;
    return slot;
  });
  const pinExtent = pins.length ? pinX - 1 + (normals.length ? 4 : 0) : 0;
  const room = Math.max(0, available - pinExtent);
  const widths = selectedTab?.pinned
    ? Array(normals.length).fill(clamp((room - Math.max(0, normals.length - 1) * 4) / Math.max(1, normals.length), 120, 240))
    : restingWidths(room, normals.length, normals.findIndex(t => t.id === selected), empty);
  const gap = lock?.gap ?? (normals.length <= 2 ? 0 : 4);
  const resolved = normals.map((t, i) => lock?.widths.get(t.id) ?? widths[i]);
  const total = resolved.reduce((sum, width) => sum + width, 0) + Math.max(0, normals.length - 1) * gap;
  const origin = lock?.origin ?? (normals.length <= 2 && !selectedTab?.pinned ? Math.max(0, (room - total) / 2) : 0);
  let x = pinExtent + origin;
  normals.forEach((tab, i) => {
    slots.push({ id: tab.id, x, width: resolved[i], pinned: false });
    x += resolved[i] + gap;
  });
  return { slots, pins: pinExtent, normalOrigin: origin, normalWidth: total,
    maxScroll: Math.max(0, Math.max(total + origin, lock?.extent ?? 0) - room) };
}

export function destination(center: number, index: number, slots: readonly { x: number; width: number }[]): number {
  let next = clamp(index, 0, slots.length - 1);
  const midpoint = (i: number) => slots[i].x + slots[i].width / 2;
  while (next + 1 < slots.length && center > (midpoint(next) + midpoint(next + 1)) / 2 + 10) next++;
  while (next > 0 && center < (midpoint(next - 1) + midpoint(next)) / 2 - 10) next--;
  return next;
}

// Exact damped spring solution. Retargeting preserves both position and velocity;
// variable refresh rates do not change the curve or destabilize an integrator.
export function advanceSpring(axis: Axis, dt: number, omega = 2 * Math.PI / 0.25, damping = 0.85): void {
  const x = axis.value - axis.target;
  const v = axis.velocity;
  if (damping >= 1) {
    const c = v + omega * x;
    const decay = Math.exp(-omega * dt);
    axis.value = axis.target + (x + c * dt) * decay;
    axis.velocity = (v - omega * c * dt) * decay;
  } else {
    const a = damping * omega;
    const b = omega * Math.sqrt(1 - damping * damping);
    const c = (v + a * x) / b;
    const cos = Math.cos(b * dt), sin = Math.sin(b * dt), decay = Math.exp(-a * dt);
    axis.value = axis.target + decay * (x * cos + c * sin);
    axis.velocity = decay * (v * cos - (a * c + b * x) * sin);
  }
  if (Math.abs(axis.value - axis.target) < 0.015 && Math.abs(axis.velocity) < 0.08) {
    axis.value = axis.target; axis.velocity = 0;
  }
}
