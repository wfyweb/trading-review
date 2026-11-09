import type { RawBill, RawFill, RawOrder } from './types';

/**
 * Bitget 返回字段在不同版本/接口间有差异，映射层一律做容错：
 * 只是"取不到"，不是"报错"。取不到的字段留 null，由上层标记为缺失，
 * 绝不用 0 顶替（见 01 文档决策 2）。
 */
function pick(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k];
  }
  return undefined;
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function feeFromFill(raw: any): { fee: string; feeCoin: string } {
  const detail = Array.isArray(raw?.feeDetail) ? raw.feeDetail[0] : undefined;
  const feeRaw = pick(detail, ['totalFee', 'fee']) ?? pick(raw, ['fee']);
  const coin = pick(detail, ['feeCoin']) ?? pick(raw, ['feeCoin']) ?? 'USDT';
  if (feeRaw === undefined) return { fee: '', feeCoin: String(coin) };
  // 交易所返回的手续费为负表示扣费；统一存为正的成本
  return { fee: String(Math.abs(Number(feeRaw))), feeCoin: String(coin) };
}

/**
 * 判断这笔成交属于哪条腿。
 * 单向持仓返回 BOTH；双向持仓返回 LONG / SHORT。
 * 字段名各版本不一致（holdSide / posSide / positionSide），
 * 老版本还会把方向编码在 tradeSide 里（如 reduce_close_long）。
 */
function positionSideOf(raw: any): string {
  const direct = pick(raw, ['holdSide', 'posSide', 'positionSide']);
  if (direct) {
    const v = String(direct).toUpperCase();
    if (v === 'LONG' || v === 'SHORT') return v;
    if (v === 'BOTH' || v === 'NET') return 'BOTH';
  }
  const tradeSide = String(pick(raw, ['tradeSide']) ?? '').toLowerCase();
  if (tradeSide.endsWith('_long')) return 'LONG';
  if (tradeSide.endsWith('_short')) return 'SHORT';
  const posMode = String(pick(raw, ['posMode']) ?? '').toLowerCase();
  if (posMode === 'hedge_mode') {
    // 双向模式但没给方向：只能按开/平语义猜，猜不出就交回 BOTH 让配对层判定
    return 'BOTH';
  }
  return 'BOTH';
}

export function mapFill(raw: any): RawFill {
  const { fee, feeCoin } = feeFromFill(raw);
  const side = String(pick(raw, ['side', 'tradeSide']) ?? '').toLowerCase();
  return {
    // v2: tradeId / price / baseVolume / cTime
    // v3（统一账户）: execId / execPrice / execQty / createdTime
    tradeId: String(pick(raw, ['tradeId', 'execId', 'fillId', 'id']) ?? ''),
    orderId: pick(raw, ['orderId']),
    symbol: String(pick(raw, ['symbol']) ?? ''),
    side: side === 'sell' ? 'sell' : 'buy',
    positionSide: positionSideOf(raw),
    price: String(pick(raw, ['price', 'fillPrice', 'execPrice']) ?? '0'),
    baseVolume: String(pick(raw, ['baseVolume', 'size', 'qty', 'fillSize', 'execQty']) ?? '0'),
    fee,
    feeCoin,
    execPnl: (() => {
      const v = pick(raw, ['execPnl', 'profit', 'pnl', 'realizedPnl']);
      return v === undefined ? null : String(v);
    })(),
    cTime: toNum(pick(raw, ['cTime', 'createTime', 'createdTime', 'ts', 'uTime'])),
    raw,
  };
}

const FUNDING_TYPES = ['funding_fee', 'funding', 'contract_funding', 'CONTRACT_FUNDING'];

export function mapBill(raw: any): RawBill {
  const businessType = String(pick(raw, ['businessType', 'type', 'bizType']) ?? '');
  return {
    billId: String(pick(raw, ['billId', 'id', 'recordId']) ?? ''),
    symbol: pick(raw, ['symbol']),
    coin: String(pick(raw, ['coin']) ?? 'USDT'),
    businessType,
    amount: String(pick(raw, ['amount', 'balanceChange', 'delta', 'change']) ?? '0'),
    fee: pick(raw, ['fee']),
    cTime: toNum(pick(raw, ['cTime', 'ts', 'createTime', 'createdTime'])),
    raw,
  };
}

export function isFundingBill(b: RawBill): boolean {
  return FUNDING_TYPES.includes(String(b.businessType).toLowerCase());
}

export function isTransferBill(b: RawBill): boolean {
  const t = String(b.businessType).toLowerCase();
  return t.includes('transfer');
}

export function mapOrder(raw: any): RawOrder {
  return {
    orderId: String(pick(raw, ['orderId', 'id']) ?? ''),
    symbol: String(pick(raw, ['symbol']) ?? ''),
    side: String(pick(raw, ['side']) ?? ''),
    tradeSide: pick(raw, ['tradeSide']),
    orderType: String(pick(raw, ['orderType', 'ordType']) ?? ''),
    status: String(pick(raw, ['status', 'state']) ?? ''),
    size: String(pick(raw, ['size', 'baseVolume', 'qty']) ?? '0'),
    priceAvg: pick(raw, ['priceAvg', 'avgPrice', 'price']),
    cTime: toNum(pick(raw, ['cTime', 'createTime', 'createdTime'])),
    uTime: toNum(pick(raw, ['uTime', 'updateTime', 'updatedTime'])) || toNum(pick(raw, ['cTime', 'createTime', 'createdTime'])),
    raw,
  };
}

/** 统一从响应里取出列表与游标，兼容 data 为数组或对象两种形态 */
export function extractList(res: any, keys: string[]): { list: any[]; cursor?: string; hasMore: boolean } {
  const d = res?.data;
  if (Array.isArray(d)) {
    return { list: d, cursor: pick(res, ['cursor', 'endId']), hasMore: d.length >= 100 };
  }
  for (const k of keys) {
    if (Array.isArray(d?.[k])) {
      const cursor = pick(d, ['cursor', 'endId', 'idLessThan']);
      return { list: d[k], cursor: cursor ? String(cursor) : undefined, hasMore: Boolean(cursor) };
    }
  }
  return { list: [], hasMore: false };
}

/** 爆仓成交判定：Bitget 用 tradeSide = burst_close_long / burst_close_short 标记强制平仓 */
export function isLiquidationFill(raw: any): boolean {
  const tradeSide = String(pick(raw, ['tradeSide', 'tradeSideType']) ?? '').toLowerCase();
  if (tradeSide.includes('burst_close')) return true;
  if (tradeSide.includes('liq')) return true;
  // 少数情况下标记在 reduceReason / closeReason 里
  const reason = String(pick(raw, ['reduceReason', 'closeReason', 'remark']) ?? '').toLowerCase();
  return reason.includes('liquidat') || reason.includes('burst');
}

/**
 * 持仓历史映射。
 * 杠杆/保证金在不同接口里的键名不一致：
 *   leverage / openLeverage / crossLeverage
 *   marginSize / openMarginSize / im / isolatedMargin
 * 取不到就留 null（UI 显示"—"），不用 0 顶替。
 */
export function mapPosition(raw: any) {
  const holdSide = String(pick(raw, ['holdSide', 'posSide', 'positionSide']) ?? 'BOTH').toUpperCase();
  return {
    positionId: String(pick(raw, ['positionId', 'posId', 'id']) ?? `${pick(raw, ['symbol'])}|${pick(raw, ['ctime', 'cTime', 'createdTime'])}`),
    symbol: String(pick(raw, ['symbol']) ?? ''),
    holdSide: holdSide === 'LONG' || holdSide === 'SHORT' ? holdSide : 'BOTH',
    marginMode: pick(raw, ['marginMode', 'tradeMode']) ? String(pick(raw, ['marginMode', 'tradeMode'])).toLowerCase() : null,
    leverage: (() => {
      const v = pick(raw, ['leverage', 'openLeverage', 'crossLeverage', 'posLeverage']);
      return v === undefined ? null : String(v);
    })(),
    marginSize: (() => {
      const v = pick(raw, ['marginSize', 'openMarginSize', 'im', 'isolatedMargin', 'margin']);
      return v === undefined ? null : String(v);
    })(),
    openAvgPrice: pick(raw, ['openAvgPrice', 'openPriceAvg', 'avgOpenPrice', 'entryPrice']) ?? null,
    closeAvgPrice: pick(raw, ['closeAvgPrice', 'closePriceAvg', 'avgClosePrice']) ?? null,
    totalQty: pick(raw, ['openTotalPos', 'total', 'qty', 'openSize', 'size']) ?? null,
    liquidatePrice: pick(raw, ['liquidatePrice', 'liqPrice', 'liquidationPrice']) ?? null,
    pnl: pick(raw, ['pnl', 'profit']) ?? null,
    netProfit: pick(raw, ['netProfit', 'netPnl']) ?? null,
    totalFunding: pick(raw, ['totalFunding', 'funding']) ?? null,
    cTime: toNum(pick(raw, ['ctime', 'cTime', 'createdTime', 'openTime'])),
    uTime: toNum(pick(raw, ['utime', 'uTime', 'updatedTime', 'closeTime'])) || toNum(pick(raw, ['ctime', 'cTime', 'createdTime'])),
    raw,
  };
}
