/** Works on localhost and ordinary HTTP demo hosts, without randomUUID's secure-context requirement. */
export function createTabId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
}
