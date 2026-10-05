import { TabStrip } from './tabs/tab-strip.ts';
import { fullEffects } from './tabs/types.ts';
import type { Tab, Effects, TabLabelMode } from './tabs/types.ts';
import { iconMarkup, symbol } from './tabs/icons.ts';
import './style.css';
import { createTabId, detachedWindowParameter, openTabWindow, receiveTabWindow } from './tabs/index.ts';

type PageKind = 'editorial' | 'news' | 'start' | 'notes';
interface PageState { kind: PageKind; heading?: string; description?: string; notes?: string }
interface WindowState { version: 1; tabs: Tab[]; selectedId: string; pages: Record<string, PageState>; effects: Effects; theme: 'light' | 'dark'; labelMode?: TabLabelMode }

async function start(): Promise<void> {
const windowToken = new URL(location.href).searchParams.get(detachedWindowParameter);
const windowStorage = `pie-web-tabs-window-${windowToken}`;
let saved: WindowState | null = null;
if (windowToken) {
  document.querySelector('#app')!.textContent = 'Opening your tab…';
  try { saved = JSON.parse(sessionStorage.getItem(windowStorage) || 'null'); } catch { /* A fresh window uses the handshake. */ }
}
const incoming = windowToken && !saved ? await receiveTabWindow<WindowState>() : null;
const boot = saved ?? incoming?.data;
if (windowToken && (!boot || boot.version !== 1 || !Array.isArray(boot.tabs) || !boot.tabs.length)) {
  incoming?.reject();
  document.querySelector('#app')!.innerHTML = '<main class="window-recovery"><h1>This tab could not be opened.</h1><p>Your original tab stays in its window.</p><a href="./">Open Pie Web Tabs</a></main>';
  return;
}
if (windowToken) document.body.classList.add('detached-workspace');

const icons = {
  engadget: { glyph: 'e', background: '#fff', color: '#111', kind: 'engadget' as const },
  aol: { glyph: 'AOL', background: '#ffda28', color: '#101010' },
  stack: { glyph: '', background: '#fff', color: '#f48024', kind: 'stack' as const },
  field: { glyph: 'F', background: '#b4ca87', color: '#263a22' },
  blank: { glyph: 'P', background: '#526941', color: '#f0f5e9' },
};
let next = 0;
const blank = (): Tab => ({ id: `new-${createTabId()}`, title: 'New Tab', address: '', icon: icons.blank });
const samples = (): Tab[] => [
  { id: `engadget-${++next}`, title: 'Engadget — Technology news and reviews', address: 'engadget.com', icon: icons.engadget },
  { id: `aol-${++next}`, title: 'News, Politics, Sports, Mail & Latest Headlines', address: 'aol.com', icon: icons.aol },
  { id: `field-${++next}`, title: 'Field Notes — a place for your thoughts', address: 'fieldnotes.local', icon: icons.field },
  { id: `stack-${++next}`, title: 'Stack Overflow — Questions and answers', address: 'stackoverflow.com', icon: icons.stack },
];

document.querySelector('#app')!.innerHTML = `
  <header class="masthead"><a class="brand" href="./" aria-label="Pie web tabs home"><span class="brand-mark">p</span><span>Pie <span class="brand-divider">/</span> <span class="brand-subtitle">Web Tabs</span></span></a><span class="edition">INTERACTION STUDY <span>01</span></span></header>
  <main>
    <section class="intro"><div><span class="eyebrow">NATIVE FEEL. WEB CANVAS.</span><h1>A little more fluid.</h1><p>Pick a tab. Move it around. Feel it settle.</p></div>
      <div class="appearance" aria-label="Preview appearance"><button type="button" data-theme-button="light" aria-pressed="false">${symbol('sun')}Light</button><button type="button" data-theme-button="dark" aria-pressed="true">${symbol('moon')}Dark</button></div>
    </section>
    <section class="browser" data-theme="dark" aria-label="Interactive tab preview">
      <div class="browser-toolbar"><div class="window-controls" aria-hidden="true"><i></i><i></i><i></i></div><div class="toolbar-divider"></div><div id="tabs"></div><button type="button" class="toolbar-button" id="all-tabs" aria-label="Show tab list" title="Show tab list">${symbol('actions')}</button></div>
      <div class="page-stack" id="pages"></div>
      <div class="browser-status"><span class="status-dot"></span><span id="page-status">Local demo</span><span class="status-hint">Right-click a tab to pin it</span></div>
    </section>
    <section class="workbench" aria-label="Demo configuration">
      <div class="scenario-panel"><div class="control-heading"><span class="section-number">01</span><h2>Set the scene</h2></div><p>A few starting points to explore.</p><div class="scenarios"><button type="button" data-scene="one">One tab</button><button type="button" data-scene="two" aria-pressed="true">Two tabs</button><button type="button" data-scene="pinned">Pinned tabs</button><button type="button" data-scene="many">Many tabs</button></div><div class="keyboard-hint"><span><kbd>←</kbd><kbd>→</kbd> switch tabs</span><span><kbd>esc</kbd> cancel drag</span></div></div>
      <div class="effects-panel"><div class="control-heading"><span class="section-number">02</span><h2>Make it yours</h2><button type="button" class="text-button" id="restore-effects">Restore full effects</button></div>
        <div class="effect-switches">${(['glass', 'refraction', 'blur', 'shadows'] as const).map(key => `<label class="effect-control"><span>${key[0].toUpperCase() + key.slice(1)}</span><input type="checkbox" data-effect="${key}" checked role="switch" aria-label="${key[0].toUpperCase() + key.slice(1)}"/><span class="toggle-track" aria-hidden="true"></span></label>`).join('')}</div>
        <label class="motion-control"><span>Motion</span><select id="motion" aria-label="Motion"><option value="full">Full animation</option><option value="reduced">Reduced motion</option><option value="off">Off</option></select><span id="quality-status">All effects on</span></label>
        <label class="motion-control"><span>Tab labels</span><select id="label-mode" aria-label="Tab labels"><option value="fixed">Application titles</option><option value="address">Editable addresses</option></select></label>
        <label class="detach-mode"><input id="window-detach" type="checkbox" role="switch" checked />Open windows on drop</label>
      </div>
    </section>
    <footer><span>Built for the details.</span><span>Standalone · Demo pages stay local</span></footer>
  </main><div class="window-notice" id="window-notice" role="status" hidden><span></span><button type="button" id="retry-window">Open window</button><button type="button" id="dismiss-window" aria-label="Dismiss window message">×</button></div>`;

const pages = document.querySelector<HTMLElement>('#pages')!;
const panels = new Map<string, HTMLElement>();
const initial = boot?.tabs ?? samples().slice(0, 2);
const pageStates = new Map(Object.entries(boot?.pages ?? {}));
const defaults = new Map<string, { heading?: string; description?: string }>();
let mounted = false;
let theme: 'light' | 'dark' = boot?.theme ?? 'dark';
let labelMode: TabLabelMode = boot?.labelMode === 'fixed' ? 'fixed' : 'address';
if (!boot) {
  try {
    const savedMode = localStorage.getItem('pie-web-tabs-label-mode');
    if (savedMode === 'fixed' || savedMode === 'address') labelMode = savedMode;
  } catch { /* Use the browser demo's explicit address mode. */ }
}
let failedTab: string | undefined;
const notice = document.querySelector<HTMLElement>('#window-notice')!;
const windowToggle = document.querySelector<HTMLInputElement>('#window-detach')!;
try { windowToggle.checked = localStorage.getItem('pie-web-tabs-detach-windows') !== 'false'; } catch { /* Full behavior is the default. */ }
windowToggle.addEventListener('change', () => { try { localStorage.setItem('pie-web-tabs-detach-windows', String(windowToggle.checked)); } catch {} });

function pageState(id: string): PageState {
  const panel = panels.get(id)!;
  const heading = panel.querySelector('h2'), description = panel.querySelector('p');
  return { kind: panel.dataset.pageKind as PageKind,
    ...(heading?.innerHTML !== defaults.get(id)?.heading ? { heading: heading?.textContent ?? '' } : {}),
    ...(description?.innerHTML !== defaults.get(id)?.description ? { description: description?.textContent ?? '' } : {}),
    ...(panel.querySelector('textarea') ? { notes: panel.querySelector('textarea')!.value } : {}) };
}
function workspaceState(tabs: readonly Tab[] = strip.items): WindowState {
  return { version: 1, tabs: [...tabs], selectedId: tabs.some(t => t.id === strip.current.id) ? strip.current.id : tabs[0].id,
    pages: Object.fromEntries(tabs.map(tab => [tab.id, pageState(tab.id)])), effects: strip.configuration, theme, labelMode };
}
function saveWorkspace(): void {
  if (!mounted || !windowToken) return;
  try { sessionStorage.setItem(windowStorage, JSON.stringify(workspaceState())); } catch { /* Live state still belongs to this window. */ }
}

function ensurePages(tabs: readonly Tab[]): void {
  for (const [id, panel] of panels) if (!tabs.some(t => t.id === id)) { panel.remove(); panels.delete(id); defaults.delete(id); pageStates.delete(id); }
  for (const tab of tabs) {
    if (panels.has(tab.id)) continue;
    const panel = document.createElement('article'); panel.id = `panel-${tab.id}`;
    panel.className = 'demo-page'; panel.role = 'tabpanel'; panel.setAttribute('aria-labelledby', `tab-${tab.id}`); panel.hidden = true;
    const memory = pageStates.get(tab.id);
    const kind = memory?.kind ?? (tab.icon.kind === 'engadget' ? 'editorial' : tab.address === 'aol.com' ? 'news' : !tab.address ? 'start' : 'notes');
    panel.dataset.pageKind = kind;
    if (kind === 'editorial') {
      panel.classList.add('editorial-page');
      panel.innerHTML = `<div class="editorial-nav"><div class="editorial-wordmark">engadget<span>·</span></div><span>TECHNOLOGY & THE EVERYDAY</span></div><div class="editorial-grid"><div class="editorial-copy"><span class="article-category">THE DESIGN EDIT</span><h2>The details<br>make the difference.</h2><p>Small interactions. Considered movement.<br>A space that feels good to spend time in.</p><button type="button" class="read-link">Keep reading <span>↗</span></button></div><div class="object-scene" aria-label="Sculptural silver speaker illustration"><div class="scene-shadow"></div><div class="speaker"><div class="speaker-top"></div><div class="speaker-grille"></div><div class="speaker-light"></div></div><span class="scene-label">FORM / FUNCTION</span><span class="scene-index">2026 — 09</span></div></div><div class="editorial-bottom"><span>01 / OBJECTS OF INTEREST</span><span>Thoughtfully put together.</span></div>`;
      panel.querySelector('.read-link')!.addEventListener('click', () => {
        const copy = panel.querySelector('.editorial-copy p')!;
        copy.textContent = 'You can switch, reorder, and pin tabs without losing your place. This page stays exactly where you left it.';
        saveWorkspace();
      });
    } else if (kind === 'news') {
      panel.classList.add('news-page');
      panel.innerHTML = `<div class="news-nav"><strong>AOL<span>.</span></strong><span>News&nbsp;&nbsp; Life&nbsp;&nbsp; Entertainment&nbsp;&nbsp; Finance</span></div><div class="news-content"><span class="article-category">A FRESH PERSPECTIVE</span><h2>Make room<br>for something good.</h2><p>Your daily collection of ideas, discoveries,<br>and things worth a closer look.</p><div class="news-cards"><div><span>01</span><strong>A slower morning</strong></div><div><span>02</span><strong>Out of the ordinary</strong></div><div><span>03</span><strong>The week ahead</strong></div></div></div>`;
    } else if (kind === 'start') {
      panel.classList.add('start-page');
      panel.innerHTML = `<span class="start-eyebrow">A NEW BEGINNING</span><h2>Where to next?</h2><p>A little room for your next idea.</p><div class="favorites">${samples().slice(0, 3).map(t => `<button type="button" data-destination="${t.address}"><span>${iconMarkup(t.icon)}</span><strong>${t.address.split('.')[0]}</strong></button>`).join('')}</div>`;
      panel.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach(button => button.addEventListener('click', () => {
        const address = button.dataset.destination!;
        strip.update(tab.id, { address, title: address });
        panel.querySelector('h2')!.textContent = address;
        panel.querySelector('p')!.textContent = 'Your demo workspace is ready.';
        saveWorkspace();
      }));
    } else {
      panel.classList.add('notes-page');
      panel.innerHTML = `<span class="article-category">FIELD NOTES</span><h2>A place to leave a thought.</h2><p>Your writing stays here as you move between tabs.</p><textarea aria-label="Notes" placeholder="Start with a thought…" spellcheck="false"></textarea><span class="notes-footer">YOURS TO REARRANGE.</span>`;
    }
    defaults.set(tab.id, { heading: panel.querySelector('h2')?.innerHTML, description: panel.querySelector('p')?.innerHTML });
    if (memory?.heading !== undefined && panel.querySelector('h2')) panel.querySelector('h2')!.textContent = memory.heading;
    if (memory?.description !== undefined && panel.querySelector('p')) panel.querySelector('p')!.textContent = memory.description;
    if (memory?.notes !== undefined && panel.querySelector('textarea')) panel.querySelector('textarea')!.value = memory.notes;
    panels.set(tab.id, panel); pages.append(panel);
  }
  if (mounted) queueMicrotask(saveWorkspace);
}
function selectPage(tab: Tab): void {
  for (const [id, panel] of panels) { panel.hidden = id !== tab.id; panel.inert = id !== tab.id; }
  document.querySelector('#page-status')!.textContent = tab.address || 'New tab';
  if (windowToken) document.title = `${tab.title} — Pie`;
  saveWorkspace();
}

const strip = new TabStrip(document.querySelector('#tabs')!, {
  labelMode,
  tabs: initial, selectedId: boot?.selectedId ?? initial[0].id, onNewTab: blank,
  onChange: ensurePages, onSelect: selectPage,
  onDetach: async request => {
    if (request.trigger === 'drag' && !windowToggle.checked) return false;
    notice.hidden = true;
    const result = await openTabWindow(request, { url: location.href, data: workspaceState([request.tab]) });
    if (!result.opened && result.reason !== 'cancelled') {
      failedTab = request.tab.id;
      notice.querySelector('span')!.textContent = result.reason === 'blocked'
        ? 'Your browser blocked the new window. The tab stayed here.'
        : 'The new window did not finish opening. Your tab stayed here.';
      notice.hidden = false;
    }
    return result.opened;
  },
  onNavigate: (tab, address) => {
    if (!address) return;
    strip.update(tab.id, { address, title: address });
    const panel = panels.get(tab.id)!;
    const title = panel.querySelector('h2'); if (title) title.textContent = address;
    selectPage(strip.current);
    saveWorkspace();
  },
});
mounted = true;
const labelControl = document.querySelector<HTMLSelectElement>('#label-mode')!;
labelControl.value = labelMode;
labelControl.addEventListener('change', () => {
  labelMode = labelControl.value as TabLabelMode; strip.setLabelMode(labelMode);
  try { localStorage.setItem('pie-web-tabs-label-mode', labelMode); } catch {}
  saveWorkspace();
});
pages.addEventListener('input', saveWorkspace);
window.addEventListener('pagehide', saveWorkspace);
document.querySelector('#retry-window')!.addEventListener('click', () => {
  if (failedTab && strip.items.some(tab => tab.id === failedTab)) void strip.detach(failedTab);
});
document.querySelector('#dismiss-window')!.addEventListener('click', () => { notice.hidden = true; });

function scene(name: string): void {
  const set = samples(); let tabs: Tab[];
  if (name === 'one') tabs = [set[0]];
  else if (name === 'pinned') { set[2].pinned = true; tabs = [set[2], set[0], set[1]]; }
  else if (name === 'many') tabs = [...set, ...Array.from({ length: 8 }, (_, i) => ({ ...set[i % 4], id: `extra-${++next}`, title: `${set[i % 4].title} ${i + 1}` }))];
  else tabs = set.slice(0, 2);
  strip.setTabs(tabs, set[0].id);
  document.querySelectorAll('[data-scene]').forEach(button => button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.scene === name)));
}
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => button.addEventListener('click', () => scene(button.dataset.scene!)));
document.querySelectorAll<HTMLButtonElement>('[data-theme-button]').forEach(button => button.addEventListener('click', () => {
  theme = button.dataset.themeButton as 'dark' | 'light';
  strip.setTheme(theme); document.querySelector<HTMLElement>('.browser')!.dataset.theme = theme;
  document.querySelectorAll('[data-theme-button]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  saveWorkspace();
}));

const storageKey = 'pie-web-tabs-effects-v1';
function applyEffects(effects: Partial<Effects>, save = true): void {
  strip.setEffects(effects);
  const configuration = strip.configuration;
  document.querySelectorAll<HTMLInputElement>('[data-effect]').forEach(input => { input.checked = configuration[input.dataset.effect as 'glass']; });
  document.querySelector<HTMLSelectElement>('#motion')!.value = configuration.motion;
  const enabled = ['glass', 'refraction', 'blur', 'shadows'].filter(key => configuration[key as 'glass']).length;
  document.querySelector('#quality-status')!.textContent = enabled === 4 && configuration.motion === 'full' ? 'All effects on' : 'Custom settings';
  if (save) { try { localStorage.setItem(storageKey, JSON.stringify(configuration)); } catch { /* Embedders may disable storage. */ } }
  saveWorkspace();
}
document.querySelectorAll<HTMLInputElement>('[data-effect]').forEach(input => input.addEventListener('change', () => applyEffects({ [input.dataset.effect!]: input.checked })));
document.querySelector<HTMLSelectElement>('#motion')!.addEventListener('change', event => applyEffects({ motion: (event.target as HTMLSelectElement).value as Effects['motion'] }));
document.querySelector('#restore-effects')!.addEventListener('click', () => applyEffects(fullEffects));
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved) {
    const checked: Partial<Effects> = {};
    for (const key of ['glass', 'refraction', 'blur', 'shadows'] as const) if (typeof saved[key] === 'boolean') checked[key] = saved[key];
    if (['full', 'reduced', 'off'].includes(saved.motion)) checked.motion = saved.motion;
    applyEffects(checked, false);
  }
} catch { /* Invalid saved settings retain the complete default experience. */ }

document.querySelector('#all-tabs')!.addEventListener('click', () => {
  const existing = document.querySelector('.tab-overview'); if (existing) { existing.remove(); return; }
  const overlay = document.createElement('div'); overlay.className = 'tab-overview'; overlay.role = 'dialog'; overlay.setAttribute('aria-label', 'Open tabs');
  const heading = document.createElement('div'); heading.className = 'overview-heading'; heading.innerHTML = '<h2>Open tabs</h2><button type="button" aria-label="Close tab list">×</button>';
  heading.querySelector('button')!.onclick = () => overlay.remove(); overlay.append(heading);
  for (const tab of strip.items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'overview-tab';
    button.innerHTML = `<span>${iconMarkup(tab.icon)}</span><strong></strong><small></small>`;
    button.querySelector('strong')!.textContent = tab.title; button.querySelector('small')!.textContent = tab.pinned ? 'Pinned' : tab.address;
    button.onclick = () => { strip.select(tab.id); overlay.remove(); }; overlay.append(button);
  }
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });
  document.querySelector('.browser')!.append(overlay); heading.querySelector('button')!.focus();
});

// Public component instance for the standalone demo's integration examples and
// read-only motion diagnostics. No frame-by-frame framework rendering required.
Object.assign(window, { tabDemo: { strip, scene } });
if (boot) applyEffects(boot.effects, false);
strip.setTheme(theme); document.querySelector<HTMLElement>('.browser')!.dataset.theme = theme;
document.querySelectorAll<HTMLElement>('[data-theme-button]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeButton === theme)));
saveWorkspace(); incoming?.accept();
}

void start();
