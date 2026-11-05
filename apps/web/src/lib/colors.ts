/**
 * SVG 里的颜色不能在属性里用 CSS 变量（Safari/部分浏览器不生效），
 * 这里统一读取 :root 的计算值，返回真实色值。
 * 涨跌配色切换时由 App 先写入 data-tone，再触发重渲染，保证读到新值。
 */
function v(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

export const C = {
  get pos() {
    return v('--pos', '#fe4b5b');
  },
  get neg() {
    return v('--neg', '#35eb68');
  },
  get t2() {
    return v('--text-2', '#5a6b7b');
  },
  get t3() {
    return v('--text-3', '#8a99a8');
  },
  get tx() {
    return v('--text', '#1f2a37');
  },
  get surface() {
    return v('--surface', '#ffffff');
  },
  get border() {
    return v('--border', '#e2e8f0');
  },
  get borderStrong() {
    return v('--border-strong', '#cbd5e1');
  },
  get accent() {
    return v('--accent', '#0ea5b7');
  },
};
