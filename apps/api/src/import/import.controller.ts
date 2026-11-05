import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { deriveTrade } from '../trades/derive';

interface ParsedRow {
  [key: string]: string;
}

const ALIASES: Record<string, string> = {
  symbol: 'symbol',
  交易对: 'symbol',
  币种: 'symbol',
  direction: 'direction',
  方向: 'direction',
  side: 'direction',
  entrytime: 'entryTime',
  开仓时间: 'entryTime',
  entrytimeutc: 'entryTime',
  exittime: 'exitTime',
  平仓时间: 'exitTime',
  entryprice: 'entryPrice',
  开仓价: 'entryPrice',
  exitprice: 'exitPrice',
  平仓价: 'exitPrice',
  quantity: 'quantity',
  qty: 'quantity',
  数量: 'quantity',
  size: 'quantity',
  margin: 'margin',
  保证金: 'margin',
  initialstopprice: 'initialStopPrice',
  止损价: 'initialStopPrice',
  stoploss: 'initialStopPrice',
  takeprofitprice: 'takeProfitPrice',
  止盈价: 'takeProfitPrice',
  tradingfee: 'tradingFee',
  手续费: 'tradingFee',
  fee: 'tradingFee',
  fundingfee: 'fundingFee',
  资金费率: 'fundingFee',
  strategy: 'strategy',
  策略: 'strategy',
  marketregime: 'marketRegime',
  行情: 'marketRegime',
  setuptype: 'setupType',
  形态: 'setupType',
};

function parseCsv(text: string): ParsedRow[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const header = splitLine(lines[0]).map((h) => ALIASES[h.toLowerCase().replace(/[\s_-]/g, '')] ?? h);

  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: ParsedRow = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

@Controller('import')
export class ImportController {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  @Post('csv')
  async csv(@Body() body: { csv: string; defaultStrategyId?: string }) {
    const acc = await this.accounts.ensureDefault();
    const rows = parseCsv(body.csv ?? '');
    let imported = 0;
    const errors: { line: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.symbol || !r.direction || !r.entryTime || !r.entryPrice || !r.quantity) {
          throw new Error('缺少必填列（symbol / direction / entryTime / entryPrice / quantity）');
        }
        const dir = /long|多|buy/i.test(r.direction) ? 'LONG' : 'SHORT';
        const derived = deriveTrade({
          direction: dir,
          entryTime: r.entryTime,
          exitTime: r.exitTime || null,
          entryPrice: r.entryPrice,
          exitPrice: r.exitPrice || null,
          quantity: r.quantity,
          initialStopPrice: r.initialStopPrice || null,
          margin: r.margin || null,
          tradingFee: r.tradingFee || null,
          fundingFee: r.fundingFee || null,
        });

        let strategyId = body.defaultStrategyId || null;
        if (r.strategy) {
          const existing = await this.prisma.strategy.findFirst({ where: { accountId: acc.id, name: r.strategy } });
          strategyId = existing
            ? existing.id
            : (await this.prisma.strategy.create({ data: { accountId: acc.id, name: r.strategy } })).id;
        }

        await this.prisma.trade.create({
          data: {
            accountId: acc.id,
            symbol: r.symbol.toUpperCase(),
            direction: dir,
            ...derived,
            marketRegime: r.marketRegime || null,
            setupType: r.setupType || null,
            strategyId,
            matchingStatus: 'MANUAL_MATCHED',
          },
        });
        imported++;
      } catch (e: any) {
        errors.push({ line: i + 2, message: e.message });
      }
    }

    return { total: rows.length, imported, failed: errors.length, errors: errors.slice(0, 20) };
  }

  @Post('preview')
  preview(@Body() body: { csv: string }) {
    const rows = parseCsv(body.csv ?? '');
    return { total: rows.length, sample: rows.slice(0, 5), headers: rows[0] ? Object.keys(rows[0]) : [] };
  }
}
