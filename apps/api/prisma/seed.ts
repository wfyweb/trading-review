import { PrismaClient } from '@prisma/client';
import { deriveTrade } from '../src/trades/derive';
import { D, key } from '../src/common/money';

const prisma = new PrismaClient();

// 演示数据：10 USDT 本金、8 倍名义、3 周、26 笔。
// 设计意图：毛收益为正，但手续费吃掉近半，刻意触发 R2/R3/R4/R5 诊断规则。

interface Row {
  symbol: string;
  dir: 'LONG' | 'SHORT';
  strategy: string;
  entry: string;
  minutes: number;
  entryPrice: string;
  exitPrice: string;
  qty: string;
  stop: string | null;
  regime: string;
  setup: string;
  tags?: string[];
  review?: {
    entryReason: string;
    exitReason: string;
    emotion: string;
    followedPlan: boolean;
    conclusion: string;
    action: string;
    score: number;
  };
  feeUnconverted?: boolean;
}

const ROWS: Row[] = [
  {
    symbol: 'BTCUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-10-12T10:12:00', minutes: 38,
    entryPrice: '62100', exitPrice: '62650', qty: '0.0013', stop: '61800', regime: 'TREND_UP', setup: '箱体上沿突破回踩',
    tags: ['按计划止盈'],
    review: { entryReason: '4H 箱体上沿放量突破，回踩不破 62000 建仓', exitReason: '第一目标位 62650 分批止盈', emotion: '平静', followedPlan: true, conclusion: '形态标准，执行到位', action: '保持', score: 88 },
  },
  {
    symbol: 'ETHUSDT', dir: 'LONG', strategy: '均线顺势', entry: '2026-10-12T14:05:00', minutes: 52,
    entryPrice: '2420', exitPrice: '2436', qty: '0.033', stop: '2404', regime: 'TREND_UP', setup: 'EMA20 上穿 EMA60',
    tags: ['按计划止盈'],
    review: { entryReason: '15m 均线金叉，回踩 EMA20 不破', exitReason: '触及前高压力', emotion: '平静', followedPlan: true, conclusion: '顺势单，位置偏晚', action: '下次等回踩更深', score: 75 },
  },
  {
    symbol: 'SOLUSDT', dir: 'SHORT', strategy: '均线顺势', entry: '2026-10-14T09:40:00', minutes: 25,
    entryPrice: '168.4', exitPrice: '166.3', qty: '0.48', stop: '169.8', regime: 'TREND_DOWN', setup: '下降通道反弹不过前高',
    tags: ['严格止损'],
    review: { entryReason: '下降通道内反弹至 EMA20 承压', exitReason: '到达通道下沿止盈', emotion: '平静', followedPlan: true, conclusion: '严格执行', action: '保持', score: 90 },
  },
  {
    symbol: 'BTCUSDT', dir: 'SHORT', strategy: '情绪追单', entry: '2026-10-14T21:15:00', minutes: 12,
    entryPrice: '63200', exitPrice: '63580', qty: '0.0012', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['追高', '无计划入场', '止损犹豫'],
    review: { entryReason: '看到快速拉升，怕错过直接市价进', exitReason: '扛不住浮亏手动平仓', emotion: '急躁', followedPlan: false, conclusion: '无信号入场，止损也没有预设', action: '禁止在无回踩确认时开仓', score: 25 },
  },
  {
    symbol: 'DOGEUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-10-15T11:20:00', minutes: 64,
    entryPrice: '0.1382', exitPrice: '0.1392', qty: '580', stop: '0.1368', regime: 'RANGE', setup: '区间中轨突破',
    tags: ['按计划止盈'],
    review: { entryReason: '区间中轨突破且成交量放大', exitReason: '上沿未破，主动离场', emotion: '平静', followedPlan: true, conclusion: '入场正确，离场略早', action: '让利润跑一段', score: 72 },
  },
  {
    symbol: 'ETHUSDT', dir: 'SHORT', strategy: '区间反转', entry: '2026-10-16T16:30:00', minutes: 41,
    entryPrice: '2470', exitPrice: '2486', qty: '0.03', stop: '2482', regime: 'RANGE', setup: '区间上沿做空',
    tags: ['提前止盈'],
    review: { entryReason: '区间上沿第三次测试', exitReason: '止损离场', emotion: '焦虑', followedPlan: true, conclusion: '形态失败，止损执行正常', action: '上沿做空需等假突破确认', score: 60 },
  },
  {
    symbol: 'XRPUSDT', dir: 'LONG', strategy: '均线顺势', entry: '2026-10-16T20:05:00', minutes: 77,
    entryPrice: '2.35', exitPrice: '2.366', qty: '34', stop: '2.318', regime: 'TREND_UP', setup: 'EMA 多头排列首次回踩',
    tags: ['按计划止盈'],
    review: { entryReason: '多头排列首次回踩 EMA20', exitReason: '到达 1R*1.5 目标', emotion: '平静', followedPlan: true, conclusion: '标准作业', action: '保持', score: 85 },
  },
  {
    symbol: 'SOLUSDT', dir: 'LONG', strategy: '情绪追单', entry: '2026-10-19T08:55:00', minutes: 9,
    entryPrice: '171.2', exitPrice: '169.9', qty: '0.45', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['追高', '重仓'],
    review: { entryReason: '早盘急涨追进去', exitReason: '快速回落平仓', emotion: '急躁', followedPlan: false, conclusion: '典型 FOMO', action: '开盘 30 分钟内不开仓', score: 20 },
  },
  {
    symbol: 'BTCUSDT', dir: 'LONG', strategy: '区间反转', entry: '2026-10-20T10:30:00', minutes: 33,
    entryPrice: '61800', exitPrice: '61620', qty: '0.0013', stop: '61500', regime: 'RANGE', setup: '区间下沿做多',
    tags: ['严格止损'],
    review: { entryReason: '区间下沿支撑', exitReason: '跌破止损', emotion: '平静', followedPlan: true, conclusion: '支撑失效，止损正确', action: '保持', score: 65 },
  },
  {
    symbol: 'ETHUSDT', dir: 'LONG', strategy: '情绪追单', entry: '2026-10-20T13:10:00', minutes: 7,
    entryPrice: '2440', exitPrice: '2428', qty: '0.032', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['无计划入场', '重仓'],
    review: { entryReason: '看到群里喊单直接进', exitReason: '浮亏扩大平仓', emotion: '恐惧', followedPlan: false, conclusion: '外部信息驱动，无独立判断', action: '不看喊单', score: 15 },
  },
  {
    symbol: 'DOGEUSDT', dir: 'SHORT', strategy: '情绪追单', entry: '2026-10-20T22:40:00', minutes: 18,
    entryPrice: '0.1425', exitPrice: '0.1451', qty: '560', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['逆势加仓'],
    review: { entryReason: '连续亏损后想扳回来', exitReason: '扛单至无法承受', emotion: '愤怒', followedPlan: false, conclusion: '报复性交易', action: '当日亏 2 笔即停手', score: 10 },
  },
  {
    symbol: 'BTCUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-10-21T09:25:00', minutes: 46,
    entryPrice: '61200', exitPrice: '61600', qty: '0.0021', stop: '60850', regime: 'TREND_UP', setup: '下跌趋势反转后首次回踩',
    tags: ['重仓'],
    review: { entryReason: '反转形态确认，想快速回本所以加倍仓位', exitReason: '1R 附近止盈', emotion: '急切', followedPlan: false, conclusion: '方向对了，但加仓理由是亏损而非信号', action: '仓位与信号等级挂钩，不与盈亏挂钩', score: 45 },
  },
  {
    symbol: 'ETHUSDT', dir: 'SHORT', strategy: '均线顺势', entry: '2026-10-21T15:50:00', minutes: 29,
    entryPrice: '2502', exitPrice: '2478', qty: '0.032', stop: '2516', regime: 'TREND_DOWN', setup: '反弹至 EMA60 承压',
    tags: ['按计划止盈'],
    review: { entryReason: 'EMA60 压制明显', exitReason: '到达目标位', emotion: '平静', followedPlan: true, conclusion: '标准顺势单', action: '保持', score: 86 },
  },
  {
    symbol: 'SOLUSDT', dir: 'LONG', strategy: '均线顺势', entry: '2026-10-23T10:05:00', minutes: 55,
    entryPrice: '164.5', exitPrice: '165.6', qty: '0.49', stop: '162.9', regime: 'TREND_UP', setup: 'EMA 多头排列回踩',
    tags: ['按计划止盈'],
    review: { entryReason: '回踩 EMA20 收阳', exitReason: '目标位止盈', emotion: '平静', followedPlan: true, conclusion: '执行到位', action: '保持', score: 84 },
  },
  {
    symbol: 'XRPUSDT', dir: 'SHORT', strategy: '区间反转', entry: '2026-10-23T19:30:00', minutes: 36,
    entryPrice: '2.44', exitPrice: '2.452', qty: '33', stop: null, regime: 'RANGE', setup: '区间上沿做空',
    tags: ['无计划入场'],
    review: { entryReason: '感觉涨不动了', exitReason: '被动平仓', emotion: '焦虑', followedPlan: false, conclusion: '凭感觉入场', action: '入场必须有可量化条件', score: 30 },
  },
  {
    symbol: 'BTCUSDT', dir: 'LONG', strategy: '情绪追单', entry: '2026-10-27T09:10:00', minutes: 6,
    entryPrice: '62800', exitPrice: '62650', qty: '0.0013', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['追高', '无计划入场'],
    review: { entryReason: '开盘冲高追进', exitReason: '回落平仓', emotion: '急躁', followedPlan: false, conclusion: 'FOMO', action: '开盘 30 分钟不开仓', score: 18 },
  },
  {
    symbol: 'ETHUSDT', dir: 'LONG', strategy: '情绪追单', entry: '2026-10-27T09:45:00', minutes: 11,
    entryPrice: '2465', exitPrice: '2452', qty: '0.033', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['追高'],
    feeUnconverted: true,
  },
  {
    symbol: 'SOLUSDT', dir: 'LONG', strategy: '情绪追单', entry: '2026-10-27T10:20:00', minutes: 8,
    entryPrice: '170.1', exitPrice: '169.2', qty: '0.47', stop: null, regime: 'HIGH_VOL', setup: '无形态',
    tags: ['重仓', '无计划入场'],
  },
  {
    symbol: 'BTCUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-10-27T14:00:00', minutes: 62,
    entryPrice: '62400', exitPrice: '62700', qty: '0.0013', stop: '62100', regime: 'TREND_UP', setup: '前高突破回踩确认',
    tags: ['按计划止盈', '等待确认'],
    review: { entryReason: '前高突破后回踩不破', exitReason: '目标位止盈', emotion: '平静', followedPlan: true, conclusion: '标准突破回踩', action: '保持', score: 92 },
  },
  {
    symbol: 'ETHUSDT', dir: 'SHORT', strategy: '均线顺势', entry: '2026-10-27T21:30:00', minutes: 44,
    entryPrice: '2495', exitPrice: '2470', qty: '0.032', stop: '2508', regime: 'TREND_DOWN', setup: '下降趋势反弹承压',
    tags: ['按计划止盈'],
  },
  {
    symbol: 'DOGEUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-10-29T11:15:00', minutes: 71,
    entryPrice: '0.1395', exitPrice: '0.1412', qty: '570', stop: '0.1379', regime: 'RANGE', setup: '横盘上沿突破',
    tags: ['严格止损'],
    review: { entryReason: '横盘两小时后上破', exitReason: '上沿压力止盈', emotion: '平静', followedPlan: true, conclusion: '执行到位', action: '保持', score: 80 },
  },
  {
    symbol: 'XRPUSDT', dir: 'LONG', strategy: '均线顺势', entry: '2026-10-29T17:40:00', minutes: 38,
    entryPrice: '2.38', exitPrice: '2.405', qty: '34', stop: '2.362', regime: 'TREND_UP', setup: '均线粘合后发散',
    tags: ['按计划止盈'],
  },
  {
    symbol: 'BTCUSDT', dir: 'SHORT', strategy: '区间反转', entry: '2026-10-31T08:30:00', minutes: 27,
    entryPrice: '63900', exitPrice: '64180', qty: '0.0013', stop: '64250', regime: 'RANGE', setup: '区间上沿做空',
    tags: ['严格止损'],
    feeUnconverted: true,
    review: { entryReason: '区间上沿第四次测试', exitReason: '突破止损', emotion: '平静', followedPlan: true, conclusion: '第四次测试往往失败，形态判断本身有问题', action: '同一区域测试第三次后不再做反转', score: 55 },
  },
  {
    symbol: 'SOLUSDT', dir: 'SHORT', strategy: '突破回踩', entry: '2026-10-31T20:10:00', minutes: 49,
    entryPrice: '172.8', exitPrice: '170.9', qty: '0.46', stop: '174.2', regime: 'TREND_DOWN', setup: '跌破颈线回抽',
    tags: ['按计划止盈'],
    review: { entryReason: '跌破颈线回抽确认', exitReason: '目标位止盈', emotion: '平静', followedPlan: true, conclusion: '标准形态', action: '保持', score: 87 },
  },
  {
    symbol: 'ETHUSDT', dir: 'LONG', strategy: '突破回踩', entry: '2026-11-02T10:50:00', minutes: 58,
    entryPrice: '2432', exitPrice: '2462', qty: '0.033', stop: '2416', regime: 'TREND_UP', setup: '箱体突破回踩',
    tags: ['按计划止盈', '等待确认'],
    review: { entryReason: '箱体上破后回踩确认', exitReason: '目标位止盈', emotion: '平静', followedPlan: true, conclusion: '执行干净', action: '保持', score: 90 },
  },
  {
    symbol: 'DOGEUSDT', dir: 'SHORT', strategy: '均线顺势', entry: '2026-11-02T22:20:00', minutes: 21,
    entryPrice: '0.1468', exitPrice: '0.1451', qty: '550', stop: '0.1482', regime: 'TREND_DOWN', setup: '反弹至 EMA20 承压',
    tags: ['严格止损'],
    review: { entryReason: '下降趋势反弹承压', exitReason: '到达目标', emotion: '平静', followedPlan: true, conclusion: '标准', action: '保持', score: 83 },
  },
];

const TAGS: { name: string; category: string; polarity: string; color: string }[] = [
  { name: '追高', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#E24B4A' },
  { name: '无计划入场', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#E24B4A' },
  { name: '止损犹豫', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#D85A30' },
  { name: '逆势加仓', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#D85A30' },
  { name: '重仓', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#BA7517' },
  { name: '提前止盈', category: 'MISTAKE', polarity: 'NEGATIVE', color: '#BA7517' },
  { name: '按计划止盈', category: 'POSITIVE', polarity: 'POSITIVE', color: '#1D9E75' },
  { name: '严格止损', category: 'POSITIVE', polarity: 'POSITIVE', color: '#1D9E75' },
  { name: '等待确认', category: 'POSITIVE', polarity: 'POSITIVE', color: '#0F6E56' },
  { name: '震荡', category: 'MARKET', polarity: 'NEUTRAL', color: '#888780' },
  { name: '单边下跌', category: 'MARKET', polarity: 'NEUTRAL', color: '#5F5E5A' },
];

const STRATEGIES = [
  { name: '突破回踩', description: '箱体/前高突破后回踩不破入场', rules: '1. 4H 或 15m 出现放量突破\n2. 回踩不跌破突破位\n3. 止损放在突破位下方 0.5%\n4. 目标 1.5R-2R' },
  { name: '均线顺势', description: 'EMA20/EMA60 多头或空头排列回踩入场', rules: '1. EMA20 与 EMA60 同向排列\n2. 首次回踩 EMA20 收阳/收阴\n3. 止损放前低/前高\n4. 目标 1.5R' },
  { name: '区间反转', description: '区间上下沿做反转', rules: '1. 区间至少测试两次\n2. 第三次测试后不再做反转\n3. 止损放区间外 0.3%' },
  { name: '情绪追单', description: '（待淘汰）无信号的情绪化入场', rules: '无固定规则，属于需要被识别并消除的行为' },
];

async function main() {
  await prisma.tradeTag.deleteMany();
  await prisma.tradeReview.deleteMany();
  await prisma.tradeFill.deleteMany();
  await prisma.ledger.deleteMany();
  await prisma.equitySnapshot.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.strategy.deleteMany();
  await prisma.account.deleteMany();

  const account = await prisma.account.create({
    data: { name: 'Bitget 主账户', exchange: 'BITGET', baselineCapital: '10', quoteCurrency: 'USDT', posMode: 'one_way_mode' },
  });

  const strategyMap = new Map<string, string>();
  for (const s of STRATEGIES) {
    const created = await prisma.strategy.create({ data: { accountId: account.id, ...s } });
    strategyMap.set(s.name, created.id);
  }

  const tagMap = new Map<string, string>();
  for (const t of TAGS) {
    const created = await prisma.tag.create({ data: { accountId: account.id, ...t } });
    tagMap.set(t.name, created.id);
  }

  let gross = D(0);
  let fee = D(0);

  for (const r of ROWS) {
    const entryTime = new Date(`${r.entry}+08:00`);
    const exitTime = new Date(entryTime.getTime() + r.minutes * 60 * 1000);
    const notional = D(r.entryPrice).times(D(r.qty));
    // Taker 0.06% 双边；含非 USDT 手续费的样本按 0 计入并打标
    const tradingFee = r.feeUnconverted ? '0' : key(notional.times(0.0006).times(2), 6);

    const derived = deriveTrade({
      direction: r.dir,
      entryTime,
      exitTime,
      entryPrice: r.entryPrice,
      exitPrice: r.exitPrice,
      quantity: r.qty,
      initialStopPrice: r.stop,
      margin: key(notional.div(8), 4),
      tradingFee,
      fundingFee: '0',
      feeUnconverted: Boolean(r.feeUnconverted),
    });

    gross = gross.plus(D(derived.grossPnl));
    fee = fee.plus(D(derived.tradingFee));

    await prisma.trade.create({
      data: {
        accountId: account.id,
        symbol: r.symbol,
        direction: r.dir,
        ...derived,
        plannedLeverage: '8',
        takeProfitPrice: null,
        strategyId: strategyMap.get(r.strategy) ?? null,
        marketRegime: r.regime,
        setupType: r.setup,
        feeUnconverted: Boolean(r.feeUnconverted),
        matchingStatus: 'MANUAL_MATCHED',
        reviewStatus: r.review ? 'DONE' : 'PENDING',
        executionScore: r.review?.score ?? null,
        tags: { create: (r.tags ?? []).filter((n) => tagMap.has(n)).map((n) => ({ tagId: tagMap.get(n)! })) },
        review: r.review
          ? {
              create: {
                entryReason: r.review.entryReason,
                exitReason: r.review.exitReason,
                emotion: r.review.emotion,
                followedPlan: r.review.followedPlan,
                reviewConclusion: r.review.conclusion,
                improvementAction: r.review.action,
                reviewedAt: exitTime,
              },
            }
          : undefined,
      },
    });
  }

  const net = gross.minus(fee);
  console.log(`账户：${account.name}｜初始资金 ${account.baselineCapital} USDT`);
  console.log(`交易笔数：${ROWS.length}`);
  console.log(`毛收益 ${gross.toFixed(4)}｜手续费 ${fee.toFixed(4)}｜净收益 ${net.toFixed(4)}`);
  console.log(`手续费 / 净收益 = ${net.isZero() ? 'N/A' : fee.div(net.abs()).times(100).toFixed(1) + '%'}`);
  console.log(`收益率 ${net.div(10).times(100).toFixed(2)}%`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
