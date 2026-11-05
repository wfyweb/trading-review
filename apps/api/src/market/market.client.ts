import { Logger } from '@nestjs/common';
import { httpFetch } from '../bitget/client';

/**
 * Bitget 公开行情客户端（无需签名）。
 * 走与交易接口相同的代理通道，避免「浏览器能看、Node 拉不动」。
 */

const BASE_URL = process.env.BITGET_BASE_URL || 'https://api.bitget.com';
const PRODUCT_TYPE = 'USDT-FUTURES';

/** 内部归一化周期 → Bitget 参数 */
export const GRANULARITY_PARAM: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
};

/** 周期毫秒数，用于估算应有 K 线根数（判断覆盖率） */
export const GRANULARITY_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

/** 用于 MFE/MAE 的优先周期：先精后粗 */
export const FALLBACK_ORDER = ['1m', '5m', '15m', '1h'];

export interface RawCandle {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export class MarketError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * 拉取一段 K 线（向后翻页）。
 * Bitget 单次最多返回 1000 根（candles）/200 根（history-candles），
 * 所以从 endTime 反复往前翻，直到覆盖 startTime 或没有更多数据。
 */
export async function fetchCandles(
  symbol: string,
  granularity: string,
  startTime: number,
  endTime: number,
  opts: { maxPages?: number } = {},
): Promise<RawCandle[]> {
  const param = GRANULARITY_PARAM[granularity];
  if (!param) throw new MarketError(`不支持的周期：${granularity}`);

  const out: RawCandle[] = [];
  const seen = new Set<number>();
  const maxPages = opts.maxPages ?? 40;
  let cursorEnd = endTime;
  let page = 0;

  while (page < maxPages && cursorEnd > startTime) {
    const qs = new URLSearchParams({
      symbol,
      productType: PRODUCT_TYPE,
      granularity: param,
      endTime: String(cursorEnd),
      limit: '200',
    });
    const url = `${BASE_URL}/api/v2/mix/market/history-candles?${qs.toString()}`;

    let res: any;
    try {
      const r = await httpFetch(url, { method: 'GET' });
      if (!r.ok) throw new MarketError(`K 线接口 HTTP ${r.status}`, r.status);
      res = await r.json();
    } catch (e: any) {
      if (e instanceof MarketError && e.status) throw e;
      throw new MarketError(`K 线请求失败：${e.message ?? e}`);
    }

    if (res.code !== '00000') {
      throw new MarketError(`Bitget 行情错误 ${res.code}：${res.msg ?? ''}`);
    }

    const rows: any[] = Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) break;

    let earliest = Number.MAX_SAFE_INTEGER;
    for (const row of rows) {
      const ts = Number(row[0]);
      if (!Number.isFinite(ts) || seen.has(ts)) continue;
      if (ts < startTime || ts > endTime) {
        earliest = Math.min(earliest, ts);
        continue;
      }
      seen.add(ts);
      out.push({
        openTime: ts,
        open: String(row[1]),
        high: String(row[2]),
        low: String(row[3]),
        close: String(row[4]),
        volume: String(row[5] ?? '0'),
      });
      earliest = Math.min(earliest, ts);
    }

    if (earliest === Number.MAX_SAFE_INTEGER) break;
    // 往更早一毫秒继续翻，避免同一根反复取
    const next = earliest - 1;
    if (next >= cursorEnd) break;
    cursorEnd = next;
    page++;
  }

  out.sort((a, b) => a.openTime - b.openTime);
  Logger.debug(`K 线 ${symbol} ${granularity}: ${out.length} 根（${page + 1} 页）`, 'MarketClient');
  return out;
}
