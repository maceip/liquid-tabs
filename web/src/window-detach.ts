import { createTabId } from './identity.ts';
import type { TabDetachRequest } from './types.ts';

const channel = 'pie-tab-window-v1';
export const detachedWindowParameter = 'pie-window';
export type WindowDetachResult = { opened: true; window: Window } | {
  opened: false; reason: 'blocked' | 'closed' | 'timeout' | 'cancelled' | 'failed';
};
export interface TabWindowOptions<T> { url: string | URL; data: T; width?: number; height?: number; timeout?: number }

/** Calls window.open synchronously, before returning its promise. Only reports
 * success after the receiving app explicitly acknowledges a completed mount. */
export function openTabWindow<T>(request: TabDetachRequest, options: TabWindowOptions<T>): Promise<WindowDetachResult> {
  const url = new URL(options.url, location.href);
  if (url.origin !== location.origin) throw new Error('Tab windows must use the same origin');
  const token = createTabId(); url.searchParams.set(detachedWindowParameter, token);
  const width = Math.round(options.width ?? 960), height = Math.round(options.height ?? 680);
  return new Promise(resolve => {
    let child: Window | null = null, finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined, closed: ReturnType<typeof setInterval> | undefined;
    const finish = (result: WindowDetachResult) => {
      if (finished) return; finished = true;
      clearTimeout(timeout); clearInterval(closed); window.removeEventListener('message', message);
      request.signal.removeEventListener('abort', abort);
      if (!result.opened && child && !child.closed) child.close();
      resolve(result);
    };
    const abort = () => finish({ opened: false, reason: 'cancelled' });
    const message = (event: MessageEvent) => {
      if (event.origin !== url.origin || event.source !== child || event.data?.channel !== channel || event.data?.token !== token) return;
      if (event.data.type === 'ready') {
        try { child!.postMessage({ channel, token, type: 'payload', data: options.data }, url.origin); }
        catch { finish({ opened: false, reason: 'failed' }); }
      } else if (event.data.type === 'mounted') finish({ opened: true, window: child! });
      else if (event.data.type === 'rejected') finish({ opened: false, reason: 'failed' });
    };
    if (request.signal.aborted) { abort(); return; }
    window.addEventListener('message', message); request.signal.addEventListener('abort', abort, { once: true });
    try {
      child = window.open(url.href, `pie-tab-${token}`,
        `popup=yes,width=${width},height=${height},left=${Math.round(request.screenX - width / 2)},top=${Math.round(request.screenY - 28)}`);
    } catch { finish({ opened: false, reason: 'failed' }); return; }
    if (!child) { finish({ opened: false, reason: 'blocked' }); return; }
    if (child.closed) { finish({ opened: false, reason: 'failed' }); return; }
    timeout = setTimeout(() => finish({ opened: false, reason: 'timeout' }), options.timeout ?? 8000);
    closed = setInterval(() => { if (child!.closed) finish({ opened: false, reason: 'closed' }); }, 150);
  });
}

export interface IncomingTabWindow<T> { data: T; accept(): void; reject(): void }

/** Child-side handshake. Call accept only after the tab and its content exist.
 * This protocol transfers application data, never HTML or code to execute. */
export function receiveTabWindow<T>(timeout = 8000): Promise<IncomingTabWindow<T> | null> {
  const token = new URL(location.href).searchParams.get(detachedWindowParameter);
  if (!token || !window.opener) return Promise.resolve(null);
  const opener = window.opener as Window, origin = location.origin;
  return new Promise(resolve => {
    const timer = setTimeout(() => { window.removeEventListener('message', message); resolve(null); }, timeout);
    const message = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== opener || event.data?.channel !== channel || event.data?.token !== token || event.data.type !== 'payload') return;
      clearTimeout(timer); window.removeEventListener('message', message);
      let answered = false;
      const answer = (type: string) => {
        if (answered) return; answered = true;
        if (!opener.closed) opener.postMessage({ channel, token, type }, origin);
      };
      resolve({ data: event.data.data as T, accept: () => answer('mounted'), reject: () => answer('rejected') });
    };
    window.addEventListener('message', message);
    opener.postMessage({ channel, token, type: 'ready' }, origin);
  });
}
