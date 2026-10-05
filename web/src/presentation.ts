import type { Tab, TabLabelMode } from './types.ts';

export function tabLabel(tab: Tab, selected: boolean, mode: TabLabelMode): string {
  return selected && mode === 'address' ? (tab.address || 'Search or enter an address') : tab.title;
}
