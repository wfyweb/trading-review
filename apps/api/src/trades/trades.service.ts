import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { D, key, compareNumeric } from '../common/money';
import { computePerformance } from '../analytics/performance';
import { deriveTrade } from './derive';
import { buildXlsx, type CellValue } from './xlsx';
import { CreateTradeDto, ReviewDto, TradeQueryDto, UpdateTradeDto } from './trades.dto';

const INCLUDE = {
  strategy: true,
  review: true,
  tags: { include: { tag: true } },
  fills: { include: { fill: true } },
} as const;

@Injectable()
export class TradesService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  /** 统计模块复用：按同一套筛选条件取全量交易（不分页） */
  async fetchAll(q: TradeQueryDto) {
    const acc = await this.accounts.ensureDefault();
    let rows = await this.prisma.trade.findMany({
      where: this.buildWhere(acc.id, q),
      include: INCLUDE,
      orderBy: { entryTime: 'desc' },
    });
    if (q.result === 'WIN') rows = rows.filter((t) => D(t.netPnl).greaterThan(0));
    if (q.result === 'LOSS') rows = rows.filter((t) => D(t.netPnl).lessThanOrEqualTo(0));
    return rows;
  }

  private buildWhere(accountId: string, q: TradeQueryDto) {
    const where: any = { accountId };

    if (q.from || q.to) {
      where.entryTime = {};
      if (q.from) where.entryTime.gte = new Date(`${q.from}T00:00:00`);
      if (q.to) where.entryTime.lte = new Date(`${q.to}T23:59:59`);
    }
    if (q.symbol) where.symbol = q.symbol;
    if (q.direction) where.direction = q.direction;
    if (q.strategyId) where.strategyId = q.strategyId;
    if (q.status) where.status = q.status;
    if (q.reviewStatus) where.reviewStatus = q.reviewStatus;
    if (q.marketRegime) where.marketRegime = q.marketRegime;
    if (q.tagId) where.tags = { some: { tagId: q.tagId } };
    if (q.q) where.OR = [{ symbol: { contains: q.q } }, { setupType: { contains: q.q } }];
    return where;
  }

  async list(q: TradeQueryDto) {
    let rows = await this.fetchAll(q);
    if (q.sort) {
      const field = q.sort as keyof (typeof rows)[number];
      const dir = q.order === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const av = a[field] as any;
        const bv = b[field] as any;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const numericFields = ['netPnl', 'grossPnl', 'rMultiple', 'tradingFee', 'entryPrice', 'quantity'];
        if (numericFields.includes(String(field))) return compareNumeric(av, bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    const total = rows.length;
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 20)));
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map(serialize);

    return {
      items,
      total,
      page,
      pageSize,
      summary: computePerformance(rows as any),
    };
  }

  async detail(id: string) {
    const trade = await this.prisma.trade.findUnique({ where: { id }, include: INCLUDE });
    if (!trade) throw new NotFoundException('交易不存在');
    return serialize(trade);
  }

  async create(dto: CreateTradeDto) {
    const acc = await this.accounts.ensureDefault();
    const derived = deriveTrade({
      direction: dto.direction,
      entryTime: dto.entryTime,
      exitTime: dto.exitTime,
      entryPrice: dto.entryPrice,
      exitPrice: dto.exitPrice,
      quantity: dto.quantity,
      initialStopPrice: dto.initialStopPrice,
      margin: dto.margin,
      tradingFee: dto.tradingFee,
      fundingFee: dto.fundingFee,
      grossPnl: dto.grossPnl,
      feeUnconverted: dto.feeUnconverted,
    });

    const trade = await this.prisma.trade.create({
      data: {
        accountId: acc.id,
        symbol: dto.symbol.toUpperCase(),
        direction: dto.direction,
        ...derived,
        plannedLeverage: dto.plannedLeverage ?? null,
        takeProfitPrice: dto.takeProfitPrice ?? null,
        strategyId: dto.strategyId || null,
        marketRegime: dto.marketRegime ?? null,
        setupType: dto.setupType ?? null,
        feeUnconverted: Boolean(dto.feeUnconverted),
        matchingStatus: 'MANUAL_MATCHED',
        reviewStatus: 'PENDING',
        tags: dto.tagIds?.length ? { create: dto.tagIds.map((tagId) => ({ tagId })) } : undefined,
        review: dto.note ? { create: { entryReason: dto.note } } : undefined,
      },
      include: INCLUDE,
    });
    return serialize(trade);
  }

  async update(id: string, dto: UpdateTradeDto) {
    const current = await this.prisma.trade.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('交易不存在');

    const merged = {
      direction: dto.direction ?? current.direction,
      entryTime: dto.entryTime ?? current.entryTime,
      exitTime: dto.exitTime ?? current.exitTime,
      entryPrice: dto.entryPrice ?? current.entryPrice,
      exitPrice: dto.exitPrice ?? current.exitPrice,
      quantity: dto.quantity ?? current.quantity,
      initialStopPrice: dto.initialStopPrice ?? current.initialStopPrice,
      margin: dto.margin ?? current.margin,
      tradingFee: dto.tradingFee ?? current.tradingFee,
      fundingFee: dto.fundingFee ?? current.fundingFee,
      grossPnl: dto.grossPnl ?? current.grossPnl,
      feeUnconverted: dto.feeUnconverted ?? current.feeUnconverted,
    };

    if (dto.status === 'NEEDS_REVIEW') merged.grossPnl = merged.grossPnl;

    const derived = deriveTrade(merged);
    const trade = await this.prisma.trade.update({
      where: { id },
      data: {
        ...derived,
        status: dto.status ?? derived.status,
        plannedLeverage: dto.plannedLeverage ?? current.plannedLeverage,
        takeProfitPrice: dto.takeProfitPrice ?? current.takeProfitPrice,
        strategyId: dto.strategyId === undefined ? current.strategyId : dto.strategyId || null,
        marketRegime: dto.marketRegime ?? current.marketRegime,
        setupType: dto.setupType ?? current.setupType,
        ...(dto.tagIds
          ? { tags: { deleteMany: {}, create: dto.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: INCLUDE,
    });
    return serialize(trade);
  }

  /**
   * 批量归类。
   * 支持三种入口：列表勾选（ids）、按当前筛选条件、按持仓时长规则。
   * dryRun 只返回命中情况，方便先确认再执行。
   */
  async batchStrategy(body: {
    ids?: string[];
    filter?: TradeQueryDto;
    strategyId?: string | null;
    holdingMinGte?: string;
    holdingMinLte?: string;
    onlyUnassigned?: boolean;
    dryRun?: boolean;
  }) {
    let rows = await this.fetchAll(body.filter ?? {});

    if (body.ids?.length) {
      const set = new Set(body.ids);
      rows = rows.filter((r) => set.has(r.id));
    }
    if (body.onlyUnassigned) {
      rows = rows.filter((r) => !r.strategyId);
    }
    if (body.holdingMinGte !== undefined && body.holdingMinGte !== '') {
      const min = Number(body.holdingMinGte) * 60;
      rows = rows.filter((r) => (r.holdingSeconds ?? 0) >= min);
    }
    if (body.holdingMinLte !== undefined && body.holdingMinLte !== '') {
      const max = Number(body.holdingMinLte) * 60;
      rows = rows.filter((r) => (r.holdingSeconds ?? 0) <= max);
    }

    const sample = rows.slice(0, 5).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      holdingMinutes: Math.round((r.holdingSeconds ?? 0) / 60),
      netPnl: r.netPnl,
    }));

    if (body.dryRun) {
      return { matched: rows.length, updated: 0, dryRun: true, sample };
    }
    if (body.strategyId === undefined) {
      throw new BadRequestException('缺少目标策略');
    }

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { matched: 0, updated: 0, sample: [] };

    const res = await this.prisma.trade.updateMany({
      where: { id: { in: ids } },
      data: { strategyId: body.strategyId || null },
    });
    return { matched: rows.length, updated: res.count, sample };
  }

  async remove(id: string) {
    await this.prisma.trade.delete({ where: { id } });
    return { ok: true };
  }

  async saveReview(id: string, dto: ReviewDto) {
    const trade = await this.prisma.trade.findUnique({ where: { id } });
    if (!trade) throw new NotFoundException('交易不存在');

    const { tagIds, executionScore, ...reviewFields } = dto;
    if (executionScore !== undefined) {
      const score = Number(executionScore);
      if (Number.isNaN(score) || score < 0 || score > 100) throw new BadRequestException('执行评分需为 0-100');
    }

    const data: any = { ...reviewFields, reviewedAt: new Date() };
    const review = await this.prisma.tradeReview.upsert({
      where: { tradeId: id },
      create: { tradeId: id, ...data },
      update: data,
    });

    const score = executionScore !== undefined ? Number(executionScore) : trade.executionScore;
    await this.prisma.trade.update({
      where: { id },
      data: {
        reviewStatus: 'DONE',
        executionScore: score ?? null,
        // 人工填分时标记来源，自动评分（AUTO）不会被静默覆盖
        ...(executionScore !== undefined ? { scoreSource: 'MANUAL', scoredAt: new Date() } : {}),
        ...(tagIds ? { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } } : {}),
      },
    });

    return { review, executionScore: score ?? null };
  }

  /** 导出 Excel：复用列表同一套筛选条件（含时间范围），不分页取全量 */
  async exportXlsx(q: TradeQueryDto) {
    const rows = await this.fetchAll(q);

    const fmtTime = (d: Date | string | null) => {
      if (!d) return '';
      const dt = new Date(d);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
    };
    const n = (v: string | null) => (v === null ? null : Number(v));
    const holdingMin = (t: any) => (t.holdingSeconds === null ? null : Math.round(t.holdingSeconds / 60));

    const headers = [
      '开仓时间', '平仓时间', '交易对', '方向', '状态', '爆仓',
      '开仓价', '平仓价', '数量', '杠杆', '保证金', '杠杆来源', '开仓时权益', '初始止损',
      '毛收益', '手续费', '资金费率', '净收益', 'R倍数',
      '持仓(分钟)', '策略', '行情环境', '形态', '标签',
      '执行评分', '复盘状态', '复盘结论',
    ];

    const data: CellValue[][] = rows.map((t: any) => [
      fmtTime(t.entryTime),
      t.exitTime ? fmtTime(t.exitTime) : '',
      t.symbol,
      t.direction === 'LONG' ? '多' : '空',
      t.status === 'OPEN' ? '持仓中' : t.status === 'NEEDS_REVIEW' ? '待确认' : '已平仓',
      t.isLiquidation ? `是(${t.liquidationCount})` : '否',
      n(t.entryPrice),
      t.exitPrice ? n(t.exitPrice) : null,
      n(t.quantity),
      t.actualLeverage ? n(t.actualLeverage) : null,
      t.margin ? n(t.margin) : null,
      t.leverageSource === 'EXCHANGE' ? '交易所' : t.leverageSource === 'ESTIMATED' ? '估算(≈)' : '',
      t.equityAtEntry ? n(t.equityAtEntry) : null,
      t.initialStopPrice ? n(t.initialStopPrice) : null,
      n(t.grossPnl),
      n(t.tradingFee),
      n(t.fundingFee),
      n(t.netPnl),
      t.rMultiple === null ? null : Number(t.rMultiple),
      holdingMin(t),
      t.strategy?.name ?? '',
      t.marketRegime ?? '',
      t.setupType ?? '',
      t.tags?.map((tt: any) => tt.tag.name).join(', ') ?? '',
      t.executionScore ?? null,
      t.reviewStatus === 'DONE' ? '已复盘' : '待复盘',
      t.review?.reviewConclusion ?? '',
    ]);

    const buffer = buildXlsx('交易记录', headers, data);
    return { buffer, count: rows.length };
  }

  async symbols() {
    const acc = await this.accounts.ensureDefault();
    const rows = await this.prisma.trade.findMany({
      where: { accountId: acc.id },
      select: { symbol: true },
      distinct: ['symbol'],
      orderBy: { symbol: 'asc' },
    });
    return rows.map((r) => r.symbol);
  }
}

function serialize(t: any) {
  return {
    ...t,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    tags: t.tags?.map((tt: any) => tt.tag) ?? [],
    review: t.review ?? null,
    fills: t.fills?.map((tf: any) => ({ role: tf.role, quantity: tf.quantity, fill: tf.fill })) ?? [],
    display: {
      netPnl: key(D(t.netPnl), 4),
      grossPnl: key(D(t.grossPnl), 4),
      rMultiple: t.rMultiple === null ? null : key(D(t.rMultiple), 2),
      tradingFee: key(D(t.tradingFee), 4),
      isWin: D(t.netPnl).greaterThan(0),
    },
  };
}
