import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  /** MVP-1 单账户：不存在则创建默认账户（初始资金 10 USDT） */
  async ensureDefault() {
    const found = await this.prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
    if (found) return found;
    return this.prisma.account.create({
      data: {
        name: 'Bitget 主账户',
        exchange: 'BITGET',
        baselineCapital: '10',
        quoteCurrency: 'USDT',
        posMode: 'one_way_mode',
      },
    });
  }

  async list() {
    await this.ensureDefault();
    return this.prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async update(id: string, data: { name?: string; baselineCapital?: string; posMode?: string }) {
    const exists = await this.prisma.account.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('账户不存在');
    return this.prisma.account.update({ where: { id }, data });
  }

  async getBaseline(): Promise<string> {
    const acc = await this.ensureDefault();
    return acc.baselineCapital ?? '10';
  }

  /**
   * 按「当前权益 − 区间累计净收益」反推期初资金。
   * 用于 90 天前本金与页面配置不一致的情况：否则回撤/收益率整段失真。
   */
  async deriveBaseline(id: string) {
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账户不存在');
    if (!acc.lastEquity) throw new BadRequestException('还没有拿到账户权益，请先点一次「测试连接」或「立即同步」');

    const trades = await this.prisma.trade.findMany({
      where: { accountId: id, status: 'CLOSED' },
      select: { netPnl: true },
    });
    const sum = trades.reduce((a, t) => a.plus(new Decimal(t.netPnl || '0')), new Decimal(0));
    const baseline = new Decimal(acc.lastEquity).minus(sum);

    return {
      lastEquity: acc.lastEquity,
      cumulativeNetPnl: sum.toFixed(4),
      suggestedBaseline: baseline.toFixed(4),
      tradeCount: trades.length,
      note: '期初资金 = 当前权益 − 累计净收益。已同步区间之前的历史未计入，如更早还有交易，结果会偏高。',
    };
  }
}
