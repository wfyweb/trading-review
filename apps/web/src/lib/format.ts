export function num(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function signed(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  const s = num(Math.abs(n), dp);
  return n > 0 ? `+${s}` : n < 0 ? `-${s}` : s;
}

/**
 * 固定盈亏配色：盈利绿、亏损红。
 * 与 pnlClass 的区别：pnlClass 跟随「涨跌配色」开关切换（中式红涨绿跌），
 * 而交易记录的净收益要求语义稳定，不随开关反转。
 */
export function fixedPnlClass(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'dim';
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return 'dim';
  return n > 0 ? 'pnl-profit' : 'pnl-loss';
}

export function pnlClass(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'dim';
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return 'dim';
  return n > 0 ? 'pos' : 'neg';
}

export function pct(v: string | number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(dp)}%`;
}

export function ratioToPct(v: string | number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${(Number(v) * 100).toFixed(dp)}%`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h${m}m` : `${h}h`;
}

export function dt(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dtFull(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 价格按量级决定小数位：BTC 保留 1 位，DOGE 保留 5 位 */
export function priceDp(v: string | number | null | undefined): number {
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n) || n === 0) return 2;
  if (n >= 1000) return 1;
  if (n >= 10) return 2;
  if (n >= 1) return 3;
  return 5;
}

/** 数量：大数量保留 2 位，小数量（币本位）保留 6 位 */
export function qtyDp(v: string | number | null | undefined): number {
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n) || n === 0) return 2;
  return n >= 1 ? 2 : 6;
}

export const REGIME_LABEL: Record<string, string> = {  TREND_UP: '单边上涨',
  TREND_DOWN: '单边下跌',
  RANGE: '震荡',
  HIGH_VOL: '高波动',
  NEWS: '消息面',
};

export const EMOTIONS = ['平静', '焦虑', '急躁', '恐惧', '贪婪', '愤怒', '亢奋'];
