import type { TabIcon } from './types.ts';
export const escapeXML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export const symbols = {
  plus: '<path d="M8 2v12M2 8h12"/>',
  close: '<circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6" stroke="var(--close-cutout, #505050)" stroke-width="1.5"/>',
  reload: '<path d="M13 5a6 6 0 1 0 1 5M13 1v4H9"/>',
  actions: '<rect x="2" y="1.5" width="12" height="7" rx="1.5"/><path d="M2 11.5h12M2 15h9"/>',
  search: '<circle cx="6.5" cy="6.5" r="4.7"/><path d="m10 10 4.5 4.5"/>',
  pin: '<path d="m5 1 6 0-1 5 3 3v1H3V9l3-3-1-5ZM8 10v5"/>',
  check: '<path d="m3 8 3 3 7-7"/>',
  left: '<path d="m10 3-5 5 5 5"/>',
  right: '<path d="m6 3 5 5-5 5"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 0v2m0 12v2M0 8h2m12 0h2M2 2l1.5 1.5m9 9L14 14M2 14l1.5-1.5m9-9L14 2"/>',
  moon: '<path d="M13.8 10.1A6.5 6.5 0 0 1 5.9 2.2a6.5 6.5 0 1 0 7.9 7.9Z"/>',
};
export function symbol(name: keyof typeof symbols): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${symbols[name]}</svg>`;
}
export function iconMarkup(icon: TabIcon): string {
  let face = `<text x="8" y="11.8" text-anchor="middle" fill="${escapeXML(icon.color)}" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="${icon.glyph.length > 1 ? 6.3 : 11.5}" font-weight="750">${escapeXML(icon.glyph)}</text>`;
  if (icon.kind === 'engadget') face = '<path d="M4 4h8v5H5.5v2H12v1.5H4V4Zm1.5 1.5v2H10.5v-2Z" fill="#111"/>';
  if (icon.kind === 'stack') face = '<path d="M3 11v3h10v-3M5 11h6M5 8.5l6 .5M6 6l5 1.5M8 3.5l4 3M11 1l2.5 4" fill="none" stroke="#f48024" stroke-width="1.6"/>';
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x=".2" y=".2" width="15.6" height="15.6" rx="2.4" fill="${escapeXML(icon.background)}"/>${face}</svg>`;
}
