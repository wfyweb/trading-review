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
    return v('--pos', '#b0655a');
  },
  get neg() {
    return v('--neg', '#6f8b73');
  },
  get t2() {
    return v('--text-2', '#7a736b');
  },
  get t3() {
    return v('--text-3', '#9a9086');
  },
  get tx() {
    return v('--text', '#3a352f');
  },
  get surface() {
    return v('--surface', '#fbfaf7');
  },
  get border() {
    return v('--border', '#e4ded4');
  },
  get borderStrong() {
    return v('--border-strong', '#d7cfc2');
  },
  get accent() {
    return v('--accent', '#a89a86');
  },
};
