export interface TabIcon {
  glyph: string;
  background: string;
  color: string;
  kind?: 'letter' | 'engadget' | 'stack';
}

export interface Tab {
  id: string;
  title: string;
  address: string;
  icon: TabIcon;
  pinned?: boolean;
  hoverContent?: TabHoverContent;
}

export type TabLabelMode = 'fixed' | 'address';
export interface TabHoverContent {
  title: string;
  subtitle?: string;
  detail?: string;
}
export interface TabHoverOptions {
  /** Pointer rest, in milliseconds. Defaults to 650. */
  delayMs?: number;
  maximumWidth?: number;
  /** Return null to suppress this tab's card. Text is rendered as text. */
  content?: (tab: Tab) => TabHoverContent | null;
}

export interface Effects {
  glass: boolean;
  refraction: boolean;
  blur: boolean;
  shadows: boolean;
  motion: 'full' | 'reduced' | 'off';
}

export const fullEffects: Effects = {
  glass: true, refraction: true, blur: true, shadows: true, motion: 'full',
};

export interface Slot { id: string; x: number; width: number; pinned: boolean }
export interface Layout { slots: Slot[]; pins: number; normalOrigin: number; normalWidth: number; maxScroll: number }
export interface Axis { value: number; velocity: number; target: number }
export interface TabDetachRequest {
  tab: Tab;
  screenX: number;
  screenY: number;
  trigger: 'drag' | 'menu' | 'api';
  signal: AbortSignal;
}
export interface TabStripOptions {
  tabs: Tab[];
  /** Fixed application labels are the default; address editing is opt-in. */
  labelMode?: TabLabelMode;
  /** False disables cards. Otherwise title/address are used unless overridden. */
  hoverPreview?: false | TabHoverOptions;
  selectedId?: string;
  effects?: Partial<Effects>;
  onSelect?: (tab: Tab) => void;
  onChange?: (tabs: readonly Tab[]) => void;
  onNavigate?: (tab: Tab, address: string) => void;
  onNewTab?: () => Tab;
  /** Visual source for the tear-off thumbnail. Defaults to #panel-${tab.id}. */
  previewContent?: (tab: Tab) => HTMLElement | null;
  /** Invoked synchronously in the release/menu gesture. Return true only after
   * the destination owns the tab; false/rejection retains it and animates back. */
  onDetach?: (request: TabDetachRequest) => boolean | Promise<boolean>;
}
