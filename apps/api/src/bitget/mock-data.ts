/**
 * Mock 行情/成交数据：用于在没有 API 密钥的情况下完整验证
 * 同步 → 标准化 → 配对 → 统计 这条链路。
 * 刻意覆盖：加仓、部分平仓、反手（一笔成交跨两个交易）、资金费率、划转、未平仓。
 */

const T = (s: string) => new Date(s).getTime();

interface MockFill {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  baseVolume: string;
  fee: string;
  feeCoin: string;
  execPnl: string | null;
  cTime: number;
}

export const MOCK_FILLS: MockFill[] = [
  // BTC：加仓 + 两次部分平仓
  { tradeId: 'm-btc-1', orderId: 'm-o-1', symbol: 'BTCUSDT', side: 'buy', price: '62000', baseVolume: '0.001', fee: '0.0372', feeCoin: 'USDT', execPnl: null, cTime: T('2026-10-25T10:00:00+08:00') },
  { tradeId: 'm-btc-2', orderId: 'm-o-2', symbol: 'BTCUSDT', side: 'buy', price: '62100', baseVolume: '0.001', fee: '0.03726', feeCoin: 'USDT', execPnl: null, cTime: T('2026-10-25T10:15:00+08:00') },
  { tradeId: 'm-btc-3', orderId: 'm-o-3', symbol: 'BTCUSDT', side: 'sell', price: '62600', baseVolume: '0.0015', fee: '0.05634', feeCoin: 'USDT', execPnl: '0.825', cTime: T('2026-10-25T11:05:00+08:00') },
  { tradeId: 'm-btc-4', orderId: 'm-o-4', symbol: 'BTCUSDT', side: 'sell', price: '62700', baseVolume: '0.0005', fee: '0.01881', feeCoin: 'USDT', execPnl: '0.325', cTime: T('2026-10-25T11:20:00+08:00') },

  // ETH：开空 + 平空
  { tradeId: 'm-eth-1', orderId: 'm-o-5', symbol: 'ETHUSDT', side: 'sell', price: '2500', baseVolume: '0.03', fee: '0.045', feeCoin: 'USDT', execPnl: null, cTime: T('2026-10-26T14:00:00+08:00') },
  { tradeId: 'm-eth-2', orderId: 'm-o-6', symbol: 'ETHUSDT', side: 'buy', price: '2478', baseVolume: '0.03', fee: '0.044604', feeCoin: 'USDT', execPnl: '0.66', cTime: T('2026-10-26T15:30:00+08:00') },

  // SOL：反手（一笔卖出同时平多 0.5 并开空 0.3）
  { tradeId: 'm-sol-1', orderId: 'm-o-7', symbol: 'SOLUSDT', side: 'buy', price: '170', baseVolume: '0.5', fee: '0.051', feeCoin: 'USDT', execPnl: null, cTime: T('2026-10-27T09:00:00+08:00') },
  { tradeId: 'm-sol-2', orderId: 'm-o-8', symbol: 'SOLUSDT', side: 'sell', price: '168', baseVolume: '0.8', fee: '0.08064', feeCoin: 'USDT', execPnl: '-1', cTime: T('2026-10-27T09:40:00+08:00') },
];

export const MOCK_BILLS = [
  {
    billId: 'm-bill-1',
    coin: 'USDT',
    businessType: 'transfer_in',
    amount: '5',
    cTime: T('2026-10-24T12:00:00+08:00'),
  },
  {
    billId: 'm-bill-2',
    coin: 'USDT',
    symbol: 'BTCUSDT',
    businessType: 'funding_fee',
    amount: '-0.0032',
    cTime: T('2026-10-25T11:00:00+08:00'),
  },
  {
    billId: 'm-bill-3',
    coin: 'USDT',
    symbol: 'ETHUSDT',
    businessType: 'funding_fee',
    amount: '0.0011',
    cTime: T('2026-10-26T14:40:00+08:00'),
  },
];

export const MOCK_ORDERS = MOCK_FILLS.map((f) => ({
  orderId: f.orderId,
  symbol: f.symbol,
  side: f.side,
  orderType: 'market',
  status: 'filled',
  size: f.baseVolume,
  priceAvg: f.price,
  cTime: f.cTime,
  uTime: f.cTime,
}));
