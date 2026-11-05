import { Logger } from '@nestjs/common';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { buildHeaders, RateLimiter, signRequest } from './signer';
import { mapBill, mapFill, mapOrder } from './mapper';
import type { AccountInfo, BitgetApi, FetchRange, Page, RawBill, RawFill, RawOrder } from './types';
import { BitgetApiError } from './types';
import { MOCK_BILLS, MOCK_FILLS, MOCK_ORDERS } from './mock-data';

const BASE_URL = process.env.BITGET_BASE_URL || 'https://api.bitget.com';
const PRODUCT_TYPE = 'USDT-FUTURES';

/**
 * 代理支持。
 * Node 自带的 fetch 不读 HTTP_PROXY/HTTPS_PROXY，所以在需要代理的网络里
 * 会出现 "fetch failed"，而浏览器却一切正常。这里显式读取环境变量，
 * 有代理就走 ProxyAgent。
 *
 * 用法：在 apps/api/.env 里加
 *   BITGET_PROXY=http://127.0.0.1:7890
 * 或直接用系统级 TUN/增强模式（那种情况下不需要配这里）。
 */
const PROXY_URL =
  process.env.BITGET_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';
let proxyAgent: ProxyAgent | null = null;
try {
  if (PROXY_URL) {
    proxyAgent = new ProxyAgent(PROXY_URL);
    Logger.log(`Bitget 请求将经由代理：${PROXY_URL}`, 'BitgetClient');
  }
} catch (e: any) {
  Logger.warn(`代理配置无效（${PROXY_URL}）：${e.message}`, 'BitgetClient');
}

export function httpFetch(url: string, init: any = {}) {
  return proxyAgent ? undiciFetch(url, { ...init, dispatcher: proxyAgent } as any) : fetch(url, init);
}

export const proxyUrl = PROXY_URL;

/**
 * Bitget 限制：查询的 startTime 不能早于 90 天前，
 * 超出会直接返回「startTime不允许早于90天前」。
 * 这里的 89 留一天余量，避免边界时刻（90 天 + 几小时）被判超限。
 */
export const MAX_LOOKBACK_DAYS = 89;

/** 两种账户模式的差异集中在这里，改接口只动这一处 */
export type AccountMode = 'CLASSIC' | 'UTA';

export const MODE_LABEL: Record<AccountMode, string> = {
  CLASSIC: '经典账户（v2）',
  UTA: '统一账户（v3）',
};

function pageOf<T>(all: T[], range: FetchRange, key: 'cTime'): Page<T> {
  const limit = Math.min(range.limit ?? 100, 100);
  const inRange = all.filter((x: any) => x[key] >= range.startTime && x[key] <= range.endTime);
  const startIdx = range.cursor ? inRange.findIndex((x: any) => String(x[key]) === range.cursor) + 1 : 0;
  const slice = inRange.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < inRange.length;
  return {
    items: slice,
    hasMore,
    cursor: hasMore ? String((slice[slice.length - 1] as any)[key]) : undefined,
  };
}

/** 离线 Mock：无密钥也能跑通整条链路，用于验证配对算法的正确性 */
export class MockBitgetClient implements BitgetApi {
  readonly mode = 'MOCK' as const;
  readonly accountMode: AccountMode = 'CLASSIC';
  readonly maxWindowDays = 3650;

  async accountInfo(): Promise<AccountInfo> {
    return { posMode: 'one_way_mode', equity: '12.34', raw: { mock: true } };
  }

  async fills(range: FetchRange): Promise<Page<RawFill>> {
    const p = pageOf(MOCK_FILLS, range, 'cTime');
    return { ...p, items: p.items.map((r: any) => ({ ...r, raw: r })) };
  }

  async bills(range: FetchRange): Promise<Page<RawBill>> {
    const p = pageOf(MOCK_BILLS, range, 'cTime');
    return { ...p, items: p.items.map((r: any) => ({ ...r, raw: r })) };
  }

  async orders(range: FetchRange): Promise<Page<RawOrder>> {
    const p = pageOf(MOCK_ORDERS, range, 'cTime');
    return { ...p, items: p.items.map((r: any) => ({ ...r, raw: r })) };
  }
}

/**
 * 真实客户端，只读。
 *
 * Bitget 有两套互不兼容的账户体系：
 *   经典账户 → /api/v2/mix/...（价格字段 price/baseVolume，分页 idLessThan，单次跨度 ≤7 天）
 *   统一账户 → /api/v3/trade/...（字段 execPrice/execQty，分页 cursor，单次跨度 ≤30 天）
 * 签名机制完全相同。统一账户的 Key 调 v2 会直接报「统一账户模式，暂不支持调用经典账户接口」。
 */
export class LiveBitgetClient implements BitgetApi {
  readonly mode = 'LIVE' as const;
  readonly maxWindowDays: number;
  private readonly logger = new Logger(LiveBitgetClient.name);
  private readonly limiter = new RateLimiter(120);

  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
    private readonly passphrase: string,
    readonly accountMode: AccountMode = 'CLASSIC',
  ) {
    this.maxWindowDays = accountMode === 'UTA' ? 30 : 7;
  }

  private get isUta() {
    return this.accountMode === 'UTA';
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: any): Promise<T> {
    await this.limiter.wait();
    const timestamp = Date.now().toString();

    // Bitget 要求 query 参数按 key 的 ASCII 升序排列后再参与签名，
    // 且签名用的字符串必须与 URL 上实际发送的完全一致。
    // 不分序会出现 sign signature error（无参数的接口不会报，所以很容易漏）。
    const queryString = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';

    const bodyString = body ? JSON.stringify(body) : '';
    const sign = signRequest({ secret: this.secret, timestamp, method, requestPath: path, queryString, body: bodyString });

    const url = `${BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;
    const headers = buildHeaders({ apiKey: this.apiKey, passphrase: this.passphrase, sign, timestamp });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await httpFetch(url, {
          method,
          headers,
          body: method === 'POST' ? bodyString : undefined,
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new BitgetApiError(`返回非 JSON：${text.slice(0, 120)}`, undefined, res.status);
        }
        if (res.status === 429) {
          this.logger.warn('触发限频，退避重试');
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (json?.code && json.code !== '00000') {
          throw new BitgetApiError(json.msg || `接口错误 ${json.code}`, json.code, res.status);
        }
        return json as T;
      } catch (e: any) {
        if (e instanceof BitgetApiError) throw e;
        if (attempt === 2) throw new BitgetApiError(`请求失败：${e.message}`);
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw new BitgetApiError('请求重试耗尽');
  }

  // ---------- 账户信息 ----------

  async accountInfo(): Promise<AccountInfo> {
    return this.isUta ? this.utaAccountInfo() : this.classicAccountInfo();
  }

  private async classicAccountInfo(): Promise<AccountInfo> {
    const res = await this.request('GET', '/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
    const usdt = list.find((a: any) => a?.marginCoin === 'USDT') ?? list[0] ?? {};
    return {
      posMode: String(usdt.posMode ?? 'one_way_mode'),
      equity: String(usdt.accountEquity ?? usdt.crossedMaxAvailable ?? '0'),
      raw: res,
    };
  }

  private async utaAccountInfo(): Promise<AccountInfo> {
    let posMode = 'one_way_mode';
    let equity = '0';

    // 账户设置读不到就是真失败（多半是密钥/签名问题），必须抛出，
    // 否则会用默认值伪装成"连接成功"。
    const settingsRaw = await this.request('GET', '/api/v3/account/settings');
    const s = settingsRaw?.data ?? {};
    posMode = String(s.posMode ?? s.holdMode ?? s.positionMode ?? 'one_way_mode');

    // 资产接口失败不影响复盘主流程，允许降级
    let assetsRaw: any = null;
    try {
      assetsRaw = await this.request('GET', '/api/v3/account/assets');
      const d = assetsRaw?.data ?? {};
      const list: any[] = Array.isArray(d) ? d : (d.assets ?? d.list ?? []);
      const usdt = list.find((a: any) => String(a?.coin).toUpperCase() === 'USDT') ?? {};
      equity = String(usdt.equity ?? usdt.balance ?? usdt.available ?? usdt.cashBalance ?? '0');
    } catch (e: any) {
      this.logger.warn(`读取 UTA 资产失败（不影响同步）：${e.message}`);
    }

    return { posMode, equity, raw: { settings: settingsRaw, assets: assetsRaw } };
  }

  // ---------- 成交 ----------

  async fills(range: FetchRange): Promise<Page<RawFill>> {
    return this.isUta ? this.utaFills(range) : this.classicFills(range);
  }

  private async classicFills(range: FetchRange): Promise<Page<RawFill>> {
    const q: Record<string, string> = {
      productType: PRODUCT_TYPE,
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.idLessThan = range.cursor;
    const res = await this.request('GET', '/api/v2/mix/order/fills', q);
    const d = res?.data ?? {};
    const list: any[] = Array.isArray(d) ? d : (d.fillList ?? d.fills ?? d.list ?? []);
    const cursor = d.endId ? String(d.endId) : undefined;
    return { items: list.map(mapFill), hasMore: list.length >= 100 && Boolean(cursor), cursor };
  }

  private async utaFills(range: FetchRange): Promise<Page<RawFill>> {
    const q: Record<string, string> = {
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.cursor = range.cursor;
    const res = await this.request('GET', '/api/v3/trade/fills', q);
    const d = res?.data ?? {};
    const list: any[] = Array.isArray(d) ? d : (d.list ?? d.fillList ?? []);
    // 统一账户里现货/杠杆/合约成交混在一起，这里只要合约
    const futures = list.filter((x: any) => String(x?.category ?? '').toUpperCase().includes('FUTURES') || !x?.category);
    const cursor = d.cursor ? String(d.cursor) : undefined;
    return { items: futures.map(mapFill), hasMore: Boolean(cursor) && list.length >= 100, cursor };
  }

  // ---------- 订单 ----------

  async orders(range: FetchRange): Promise<Page<RawOrder>> {
    return this.isUta ? this.utaOrders(range) : this.classicOrders(range);
  }

  private async classicOrders(range: FetchRange): Promise<Page<RawOrder>> {
    const q: Record<string, string> = {
      productType: PRODUCT_TYPE,
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.idLessThan = range.cursor;
    const res = await this.request('GET', '/api/v2/mix/order/orders-history', q);
    const d = res?.data ?? {};
    const list: any[] = Array.isArray(d) ? d : (d.entrustList ?? d.orderList ?? d.list ?? []);
    const cursor = d.endId ? String(d.endId) : undefined;
    return { items: list.map(mapOrder), hasMore: list.length >= 100 && Boolean(cursor), cursor };
  }

  private async utaOrders(range: FetchRange): Promise<Page<RawOrder>> {
    const q: Record<string, string> = {
      category: PRODUCT_TYPE,
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.cursor = range.cursor;
    const res = await this.request('GET', '/api/v3/trade/history-orders', q);
    const d = res?.data ?? {};
    const list: any[] = Array.isArray(d) ? d : (d.list ?? d.orderList ?? []);
    const cursor = d.cursor ? String(d.cursor) : undefined;
    return { items: list.map(mapOrder), hasMore: Boolean(cursor) && list.length >= 100, cursor };
  }

  // ---------- 资金流水 ----------

  async bills(range: FetchRange): Promise<Page<RawBill>> {
    return this.isUta ? this.utaBills(range) : this.classicBills(range);
  }

  private async classicBills(range: FetchRange): Promise<Page<RawBill>> {
    const q: Record<string, string> = {
      productType: PRODUCT_TYPE,
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.idLessThan = range.cursor;
    const res = await this.request('GET', '/api/v2/mix/account/bill', q);
    const d = res?.data ?? {};
    const list: any[] = Array.isArray(d) ? d : (d.bills ?? d.billList ?? d.list ?? []);
    const cursor = d.endId ? String(d.endId) : undefined;
    return { items: list.map(mapBill), hasMore: list.length >= 100 && Boolean(cursor), cursor };
  }

  private async utaBills(range: FetchRange): Promise<Page<RawBill>> {
    const q: Record<string, string> = {
      startTime: String(range.startTime),
      endTime: String(range.endTime),
      limit: String(Math.min(range.limit ?? 100, 100)),
    };
    if (range.cursor) q.cursor = range.cursor;
    try {
      const res = await this.request('GET', '/api/v3/account/financial-records', q);
      const d = res?.data ?? {};
      const list: any[] = Array.isArray(d) ? d : (d.list ?? d.records ?? []);
      const cursor = d.cursor ? String(d.cursor) : undefined;
      return { items: list.map(mapBill), hasMore: Boolean(cursor) && list.length >= 100, cursor };
    } catch (e: any) {
      // 流水接口拿不到不影响复盘主流程：资金费率会退化为 0 并标记缺失
      this.logger.warn(`读取 UTA 资金流水失败（资金费率将缺失）：${e.message}`);
      return { items: [], hasMore: false };
    }
  }
}

/** 统一账户的 Key 调 v2 接口时，Bitget 返回的特征错误 */
export function isUnifiedAccountError(e: any): boolean {
  const msg = String(e?.message ?? '');
  return /统一账户|统一交易账户|unified\s+(trading\s+)?account|UTA/i.test(msg);
}

/**
 * 自动判定账户体系：
 * 先用经典账户探一次，若报「统一账户不支持经典接口」则切到 v3 重试。
 * 探测成功的模式会由调用方落库，下次直接指定，避免每次都白撞一次。
 */
export async function detectClient(
  creds: { apiKey: string; secret: string; passphrase: string },
  preferred?: AccountMode | null,
): Promise<{ client: LiveBitgetClient; mode: AccountMode; info: AccountInfo }> {
  if (preferred === 'UTA') {
    const client = new LiveBitgetClient(creds.apiKey, creds.secret, creds.passphrase, 'UTA');
    return { client, mode: 'UTA', info: await client.accountInfo() };
  }

  const classic = new LiveBitgetClient(creds.apiKey, creds.secret, creds.passphrase, 'CLASSIC');
  try {
    const info = await classic.accountInfo();
    return { client: classic, mode: 'CLASSIC', info };
  } catch (e: any) {
    if (!isUnifiedAccountError(e)) throw e;
    const uta = new LiveBitgetClient(creds.apiKey, creds.secret, creds.passphrase, 'UTA');
    return { client: uta, mode: 'UTA', info: await uta.accountInfo() };
  }
}

export function createClient(creds?: { apiKey: string; secret: string; passphrase: string } | null): BitgetApi {
  if (creds?.apiKey && creds?.secret && creds?.passphrase) {
    return new LiveBitgetClient(creds.apiKey, creds.secret, creds.passphrase, 'CLASSIC');
  }
  return new MockBitgetClient();
}
