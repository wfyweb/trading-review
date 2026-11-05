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
