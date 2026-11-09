export interface RawFill {
  tradeId: string;
  orderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** BOTH（单向持仓）| LONG | SHORT（双向持仓） */
  positionSide?: string;
  price: string;
  baseVolume: string;
  fee: string;
  feeCoin: string;
  execPnl: string | null;
  cTime: number;
  raw: unknown;
}

export interface RawBill {
  billId: string;
  symbol?: string;
  coin: string;
  businessType?: string;
  amount: string;
  fee?: string;
  cTime: number;
  raw: unknown;
}

export interface RawOrder {
  orderId: string;
  symbol: string;
  side: string;
  tradeSide?: string;
  orderType: string;
  status: string;
  size: string;
  priceAvg?: string;
  cTime: number;
  uTime: number;
  raw: unknown;
}

/**
 * 持仓历史。成交流水里没有杠杆和保证金，只能从这个接口拿。
 * 字段名在 v2 / v3 之间有差异，取值一律走别名容错，取不到留 null。
 */
export interface RawPosition {
  positionId: string;
  symbol: string;
  /** LONG | SHORT */
  holdSide: string;
  marginMode?: string | null;
  leverage?: string | null;
  marginSize?: string | null;
  openAvgPrice?: string | null;
  closeAvgPrice?: string | null;
  totalQty?: string | null;
  liquidatePrice?: string | null;
  pnl?: string | null;
  netProfit?: string | null;
  totalFunding?: string | null;
  cTime: number;
  uTime: number;
  raw: unknown;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  cursor?: string;
}

export interface FetchRange {
  startTime: number;
  endTime: number;
  cursor?: string;
  limit?: number;
}

export interface AccountInfo {
  posMode: string;
  equity: string;
  raw: unknown;
}

export interface BitgetApi {
  readonly mode: 'LIVE' | 'MOCK';
  /** CLASSIC（经典账户 v2）| UTA（统一账户 v3） */
  readonly accountMode: 'CLASSIC' | 'UTA';
  /** 单次请求允许的最大时间跨度（天）：v2 为 7，v3 为 30 */
  readonly maxWindowDays: number;
  accountInfo(): Promise<AccountInfo>;
  fills(range: FetchRange): Promise<Page<RawFill>>;
  bills(range: FetchRange): Promise<Page<RawBill>>;
  orders(range: FetchRange): Promise<Page<RawOrder>>;
  /** 持仓历史：用于补齐杠杆、保证金、强平价（UTA 历史接口不返回 leverage/marginSize） */
  positions(range: FetchRange): Promise<Page<RawPosition>>;
  /** 当前持仓：UTA 里唯一带 leverage / marginSize 的接口，用于未平仓交易 */
  currentPositions(): Promise<RawPosition[]>;
}

export class BitgetApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BitgetApiError';
  }
}
