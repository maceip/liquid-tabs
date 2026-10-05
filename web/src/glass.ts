import { escapeXML, iconMarkup } from './icons.ts';
import type { Effects, Tab, TabLabelMode } from './types.ts';
import { tabLabel } from './presentation.ts';

const NS = 'http://www.w3.org/2000/svg';
let nextID = 0;
export interface GlassSample { tab: Tab; x: number; width: number; selected: boolean }

/** A tab-sized optical layer. It mirrors only intersecting tab faces, never pages.
 * The same SVG/filter/pool is reused for a complete gesture. This works without
 * SVG-in-backdrop-filter support, which differs between browser engines. */
export class GlassLens {
  readonly element: SVGSVGElement;
  private readonly id = `tab-lens-${++nextID}`;
  private readonly map: SVGFEImageElement;
  private readonly blur: SVGFEGaussianBlurElement;
  private readonly displacement: SVGFEDisplacementMapElement;
  private readonly faces: SVGGElement;
  private pool = new Map<string, { group: SVGGElement; signature: string }>();
  private mapBucket = 0;
  private maps = new Map<number, string>();
  private measure = document.createElement('canvas').getContext('2d')!;
  private textCache = new Map<string, string>();

  constructor() {
    this.element = document.createElementNS(NS, 'svg');
    this.element.classList.add('glass-lens');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `<defs>
      <filter id="${this.id}" x="-10%" y="-40%" width="120%" height="180%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.65" result="soft"/>
        <feImage x="0" y="0" width="280" height="36" preserveAspectRatio="none" result="field"/>
        <feDisplacementMap in="soft" in2="field" scale="18" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <clipPath id="${this.id}-clip"><rect x="0" y="0" width="280" height="36" rx="18"/></clipPath>
    </defs><g clip-path="url(#${this.id}-clip)"><g filter="url(#${this.id})" class="lens-faces"></g></g>`;
    this.map = this.element.querySelector('feImage')!;
    this.blur = this.element.querySelector('feGaussianBlur')!;
    this.displacement = this.element.querySelector('feDisplacementMap')!;
    this.faces = this.element.querySelector('.lens-faces')!;
    this.measure.font = '13px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
  }

  private field(width: number): string {
    const cached = this.maps.get(width);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2; canvas.height = 72;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) / 2, py = (y + 0.5) / 2;
      const qx = px - Math.max(18, Math.min(width - 18, px));
      const qy = py - 18;
      const length = Math.hypot(qx, qy);
      const distance = 18 - length;
      const edge = Math.pow(Math.max(0, 1 - Math.max(0, distance) / 11), 1.65);
      const nx = length ? qx / length : 0, ny = length ? qy / length : 0;
      const p = (y * canvas.width + x) * 4;
      pixels.data[p] = Math.round(128 + nx * edge * 100 + (px / width - 0.5) * 17);
      pixels.data[p + 1] = Math.round(128 + ny * edge * 100);
      pixels.data[p + 2] = 128; pixels.data[p + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL();
    if (this.maps.size >= 12) this.maps.delete(this.maps.keys().next().value!);
    this.maps.set(width, url);
    return url;
  }

  private truncate(text: string, width: number): string {
    const key = `${text}:${Math.round(width)}`;
    const cached = this.textCache.get(key);
    if (cached !== undefined) return cached;
    let result = text;
    if (this.measure.measureText(text).width > width) {
      let low = 0, high = text.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (this.measure.measureText(text.slice(0, mid) + '…').width <= width) low = mid;
        else high = mid - 1;
      }
      result = text.slice(0, low) + '…';
    }
    if (this.textCache.size > 256) this.textCache.clear();
    this.textCache.set(key, result);
    return result;
  }

  render(samples: GlassSample[], x: number, width: number, effects: Effects, dark: boolean, mode: TabLabelMode): void {
    this.element.style.display = effects.glass ? '' : 'none';
    if (!effects.glass) return;
    this.element.setAttribute('viewBox', `0 0 ${width} 36`);
    this.element.querySelector('clipPath rect')!.setAttribute('width', String(width));
    this.map.setAttribute('width', String(width));
    const bucket = Math.max(36, Math.round(width / 16) * 16);
    if (bucket !== this.mapBucket) {
      this.mapBucket = bucket;
      this.map.setAttribute('href', this.field(bucket));
    }
    this.blur.setAttribute('stdDeviation', effects.blur ? '0.65' : '0');
    this.displacement.setAttribute('scale', effects.refraction ? '18' : '0');
    const visible = new Set<string>();
    for (const sample of samples) {
      if (sample.x + sample.width < x - 10 || sample.x > x + width + 10) continue;
      visible.add(sample.tab.id);
      let face = this.pool.get(sample.tab.id);
      if (!face) {
        const group = document.createElementNS(NS, 'g');
        this.faces.append(group); face = { group, signature: '' }; this.pool.set(sample.tab.id, face);
      }
      face.group.style.display = '';
      face.group.setAttribute('transform', `translate(${sample.x - x},0)`);
      const w = Math.round(sample.width * 2) / 2;
      const signature = `${sample.tab.title}|${sample.tab.address}|${w}|${sample.selected}|${sample.tab.pinned}|${dark}|${mode}|${JSON.stringify(sample.tab.icon)}`;
      if (face.signature === signature) continue;
      face.signature = signature;
      const pin = sample.tab.pinned && !sample.selected;
      const text = pin ? '' : this.truncate(tabLabel(sample.tab, sample.selected, mode), Math.max(0, w - 64));
      const textWidth = this.measure.measureText(text).width;
      const groupWidth = pin ? 16 : 22 + textWidth;
      const start = Math.max(pin ? 10 : 27, (w - groupWidth) / 2);
      face.group.innerHTML = `${sample.selected ? `<rect x="3.5" y="3.5" width="${Math.max(0, w - 7)}" height="29" rx="14.5" fill="${dark ? '#ffffff' : '#ffffff'}" fill-opacity="${dark ? '.15' : '.7'}"/>` : ''}
        <svg x="${start}" y="10" width="16" height="16" viewBox="0 0 16 16">${iconMarkup(sample.tab.icon)}</svg>
        <text x="${start + 22}" y="22.5" fill="${dark ? '#eeeeef' : '#252526'}" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13">${escapeXML(text)}</text>`;
    }
    for (const [id, face] of this.pool) if (!visible.has(id)) face.group.style.display = 'none';
  }

  clear(): void { this.element.remove(); this.faces.replaceChildren(); this.pool.clear(); }
}
