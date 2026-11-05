export function go(path: string) {
  window.location.hash = `#/${path}`;
}

export function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'overview';
}
