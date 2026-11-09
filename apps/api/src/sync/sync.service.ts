import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { SecretsService, type Credentials } from '../secrets/secrets.service';
import {
  createClient,
  detectClient,
  httpFetch,
  isUnifiedAccountError,
  MAX_LOOKBACK_DAYS,
  MODE_LABEL,
  proxyUrl,
  type AccountMode,
} from '../bitget/client';
import { isFundingBill, isLiquidationFill, isTransferBill } from '../bitget/mapper';
import type { BitgetApi, FetchRange } from '../bitget/types';
import { MatchingService } from '../matching/matching.service';
import { LeverageService } from '../analytics/leverage.service';

type LogLevel = 'info' | 'warn' | 'error';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private secrets: SecretsService,
    private matching: MatchingService,
    private leverage: LeverageService,
  ) {}

  // ---------- 配置 ----------

  async getConfig() {
    const acc = await this.accounts.ensureDefault();
    const { creds, source, note } = this.secrets.resolve(acc.id);
    return {
      accountId: acc.id,
      configured: Boolean(creds?.apiKey && creds?.secret && creds?.passphrase),
      credentialSource: source,
      credentialNote: note,
      apiKeyMasked: this.secrets.mask(creds?.apiKey ?? acc.apiKey),
      posMode: acc.posMode,
      accountMode: acc.accountMode ?? null,
      accountModeLabel: acc.accountMode ? MODE_LABEL[acc.accountMode as AccountMode] : null,
      lastSyncAt: acc.lastSyncAt,
      baselineCapital: acc.baselineCapital,
      mode: creds ? 'LIVE' : 'MOCK',
    };
  }

  async saveConfig(body: { apiKey?: string; secret?: string; passphrase?: string; baselineCapital?: string }) {
    const acc = await this.accounts.ensureDefault();
    if (body.apiKey && body.secret && body.passphrase) {
      const apiKey = body.apiKey.trim();
      const secret = body.secret.trim();
      const passphrase = body.passphrase.trim();
      validateCredentials({ apiKey, secret, passphrase });
      this.secrets.save(acc.id, { apiKey, secret, passphrase });
      await this.prisma.account.update({
        where: { id: acc.id },
        data: { apiKey, secretRef: `local-file:${acc.id}`, passphraseRef: `local-file:${acc.id}` },
      });
    }
    if (body.baselineCapital) {
      await this.prisma.account.update({ where: { id: acc.id }, data: { baselineCapital: body.baselineCapital } });
    }
    return this.getConfig();
  }

  async clearConfig() {
    const acc = await this.accounts.ensureDefault();
    this.secrets.remove(acc.id);
    await this.prisma.account.update({ where: { id: acc.id }, data: { apiKey: null, secretRef: null, passphraseRef: null } });
    const cfg = await this.getConfig();
    return {
      ...cfg,
      clearedNote:
        cfg.credentialSource === 'ENV'
          ? '已清除页面保存的密钥。检测到 apps/api/.env 中仍有预置密钥，当前会继续使用 .env 里的那一份。'
          : '已清除本地密钥。',
    };
  }

  /**
   * 连通性测试。
   * 优先使用本次请求传入的密钥（用户刚填、可能还没保存），
   * 没传才读本地已保存的。这样"填完直接点测试"的行为符合直觉。
   */
  async testConnection(body?: { apiKey?: string; secret?: string; passphrase?: string }) {
    const acc = await this.accounts.ensureDefault();

    const inputCreds =
      body?.apiKey && body?.secret && body?.passphrase
        ? { apiKey: body.apiKey.trim(), secret: body.secret.trim(), passphrase: body.passphrase.trim() }
        : null;
    if (inputCreds) validateCredentials(inputCreds);
    const { creds: savedCreds, source: savedSource } = this.secrets.resolve(acc.id);
    const creds = inputCreds ?? savedCreds;
    const source: 'input' | 'saved' | 'none' = inputCreds ? 'input' : savedCreds ? 'saved' : 'none';

    if (!creds) {
      return {
        ok: false,
        mode: 'MOCK',
        source,
        credentialSource: savedSource,
        error:
          '还没有可用的密钥：在 apps/api/.env 里填 BITGET_API_KEY / BITGET_SECRET_KEY / BITGET_PASSPHRASE（改完重启），或在下方输入后点「保存密钥」',
      };
    }

    const client = createClient(creds);
    const preferred = (acc.accountMode as AccountMode) ?? null;

    try {
      // 自动适配经典账户 / 统一账户两套接口
      const detected = await detectClient(creds, preferred);

      const { mode, info } = detected;
      const hedge = String(info.posMode).includes('hedge');
      await this.prisma.account.update({
        where: { id: acc.id },
        data: { accountMode: mode, ...(hedge ? {} : { posMode: info.posMode }), lastEquity: info.equity },
      });

      return {
        ok: true,
        mode: 'LIVE',
        source,
        credentialSource: inputCreds ? 'INPUT' : savedSource,
        accountMode: mode,
        accountModeLabel: MODE_LABEL[mode],
        posMode: info.posMode,
        equity: info.equity,
        warning: hedge
          ? '双向持仓模式：系统会按多头、空头两条腿分别配对（同一交易对可同时存在多单与空单）。'
          : mode === 'UTA'
            ? '检测到统一账户（UTA），已自动切换到 v3 接口。'
            : null,
      };
    } catch (e: any) {
      return {
        ok: false,
        mode: client.mode,
        source,
        credentialSource: inputCreds ? 'INPUT' : savedSource,
        accountMode: preferred ?? 'CLASSIC',
        error: describeError(e),
      };
    }
  }

  /** 网络自检：不涉及密钥，只判断这台机器能不能连上 Bitget */
  async netCheck() {
    const steps: { name: string; ok: boolean; detail: string; ms: number }[] = [];

    const dnsStart = Date.now();
    try {
      const dns = await import('dns/promises');
      const addr = await dns.lookup('api.bitget.com');
      steps.push({ name: 'DNS 解析', ok: true, detail: `api.bitget.com → ${addr.address}`, ms: Date.now() - dnsStart });
    } catch (e: any) {
      steps.push({ name: 'DNS 解析', ok: false, detail: e.code || e.message, ms: Date.now() - dnsStart });
    }

    const base = process.env.BITGET_BASE_URL || 'https://api.bitget.com';
    const httpStart = Date.now();
    try {
      const res = await httpFetch(`${base}/api/v2/public/time`, { signal: AbortSignal.timeout(10000) });
      const body = await res.text();
      steps.push({
        name: 'HTTPS 请求',
        ok: res.ok,
        detail: res.ok ? `HTTP ${res.status}｜${body.slice(0, 80)}` : `HTTP ${res.status}`,
        ms: Date.now() - httpStart,
      });
    } catch (e: any) {
      steps.push({ name: 'HTTPS 请求', ok: false, detail: describeError(e), ms: Date.now() - httpStart });
    }

    const ok = steps.every((s) => s.ok);
    return {
      ok,
      baseUrl: base,
      proxy: proxyUrl || null,
      steps,
      advice: ok
        ? `网络正常${proxyUrl ? `（经代理 ${proxyUrl}）` : ''}。如果测试连接仍失败，问题在密钥权限或密钥内容。`
        : proxyUrl
          ? `已配置代理 ${proxyUrl}，但仍然连不上。请检查：① 代理软件是否在运行 ② 端口是否填对 ③ 代理规则是否把 api.bitget.com 走了直连。`
          : '这台机器连不上 Bitget，且没有配置代理。请在 apps/api/.env 里设置 BITGET_PROXY=http://127.0.0.1:7890（端口换成你自己的）后重启后端。',
    };
  }

  // ---------- 同步 ----------

  async run(body: { from?: string; to?: string; limit?: number }) {
    const acc = await this.accounts.ensureDefault();
    if (this.running.has(acc.id)) throw new BadRequestException('已有同步任务在执行');

    const to = body.to ? new Date(`${body.to}T23:59:59`) : new Date();
    let from = body.from ? new Date(`${body.from}T00:00:00`) : new Date(to.getTime() - 90 * 86400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('日期格式不正确');
    if (from >= to) throw new BadRequestException('开始时间必须早于结束时间');

    const { creds, source: credSource } = this.secrets.resolve(acc.id);
    // 交易所限制：startTime 不能早于 90 天前。超了就自动收敛，而不是把报错抛给用户。
    let clampedFrom: Date | null = null;
    if (creds) {
      const earliest = new Date(to.getTime() - MAX_LOOKBACK_DAYS * 86400_000);
      if (from < earliest) {
        clampedFrom = earliest;
        from = earliest;
      }
    }

    let client = createClient(creds);

    const job = await this.prisma.syncJob.create({
      data: {
        accountId: acc.id,
        status: 'RUNNING',
        mode: client.mode,
        requestedFrom: from,
        requestedTo: to,
        startedAt: new Date(),
      },
    });

    this.running.add(acc.id);
    const logs: { t: string; level: LogLevel; msg: string }[] = [];
    const log = (msg: string, level: LogLevel = 'info') => {
      logs.push({ t: new Date().toISOString(), level, msg });
      this.logger.log(msg);
    };

    try {
      log(`开始同步 ${fmt(from)} → ${fmt(to)}（${client.mode}）`);
      if (clampedFrom) {
        log(
          `开始时间已自动调整为 ${fmt(clampedFrom)}：交易所限制最多回溯 ${MAX_LOOKBACK_DAYS} 天，更早的成交无法通过 API 拉取`,
          'warn',
        );
      }
      log(`密钥来源：${credSource === 'ENV' ? 'apps/api/.env' : credSource === 'LOCAL' ? '页面保存（本地加密）' : '无'}`);

      // 自动识别经典账户 / 统一账户，两者的接口路径与字段都不同
      let info;
      if (creds) {
        const detected = await detectClient(creds, (acc.accountMode as AccountMode) ?? null);
        client = detected.client;
        info = detected.info;
        log(`账户体系：${MODE_LABEL[detected.mode]}｜单次请求跨度上限 ${client.maxWindowDays} 天`);
        await this.prisma.account.update({ where: { id: acc.id }, data: { accountMode: detected.mode } });
      } else {
        info = await client.accountInfo();
      }

      log(`账户读取成功，持仓模式 ${info.posMode}`);
      const hedge = String(info.posMode).includes('hedge');
      if (hedge) {
        // 双向持仓：多、空两条腿分别配对。只要成交里带了方向字段就能正确处理，
        // 没有方向字段时配对层会把它当成单向处理并在结果里体现异常。
        log('双向持仓模式：多、空将作为两条独立的腿分别配对', 'warn');
      }
      await this.prisma.account.update({ where: { id: acc.id }, data: { posMode: info.posMode, lastEquity: info.equity } });

      const window: FetchRange = { startTime: from.getTime(), endTime: to.getTime(), limit: body.limit ?? 100 };

      const fills = await this.fetchAll(client, 'fills', window, log);
      let insertedFills = 0;
      let liqBackfilled = 0;
      for (const f of fills) {
        const id = f.tradeId || `${f.symbol}-${f.cTime}-${f.price}-${f.baseVolume}`;
        const isLiq = isLiquidationFill(f.raw);
        const exists = await this.prisma.fill.findUnique({
          where: { accountId_exchangeFillId: { accountId: acc.id, exchangeFillId: id } },
        });
        if (exists) {
          // 历史数据补标：以前版本没解析爆仓，重同步时顺手修好
          if (isLiq && !exists.isLiquidation) {
            await this.prisma.fill.update({ where: { id: exists.id }, data: { isLiquidation: true } });
            liqBackfilled++;
          }
          continue;
        }
        await this.prisma.fill.create({
          data: {
            accountId: acc.id,
            exchangeFillId: id,
            symbol: f.symbol,
            side: f.side.toUpperCase(),
            positionSide: f.positionSide ?? 'BOTH',
            price: f.price,
            quantity: f.baseVolume,
            fee: f.feeCoin === 'USDT' ? f.fee || '0' : '0',
            feeCoin: f.feeCoin,
            execPnl: f.execPnl,
            isLiquidation: isLiq,
            filledAt: new Date(f.cTime),
            rawPayload: JSON.stringify(f.raw),
          },
        });
        insertedFills++;
      }
      const liqCount = fills.filter((f) => isLiquidationFill(f.raw)).length;
      log(
        `成交 ${fills.length} 条，新增 ${insertedFills} 条，去重 ${fills.length - insertedFills} 条` +
          (liqCount > 0 ? `，其中强平成交 ${liqCount} 条` : '') +
          (liqBackfilled > 0 ? `（历史补标 ${liqBackfilled} 条）` : ''),
        liqCount > 0 ? 'warn' : 'info',
      );

      const orders = await this.fetchAll(client, 'orders', window, log);
      let insertedOrders = 0;
      for (const o of orders) {
        if (!o.orderId) continue;
        const exists = await this.prisma.order.findUnique({
          where: { accountId_exchangeOrderId: { accountId: acc.id, exchangeOrderId: o.orderId } },
        });
        if (exists) continue;
        await this.prisma.order.create({
          data: {
            accountId: acc.id,
            exchangeOrderId: o.orderId,
            symbol: o.symbol,
            side: o.side,
            positionSide: 'BOTH',
            orderType: o.orderType,
            status: o.status,
            quantity: o.size,
            filledQty: o.size,
            averagePrice: o.priceAvg ? String(o.priceAvg) : null,
            createdAt: new Date(o.cTime || Date.now()),
            updatedAt: new Date(o.uTime || o.cTime || Date.now()),
            rawPayload: JSON.stringify(o.raw),
          },
        });
        insertedOrders++;
      }
      log(`订单 ${orders.length} 条，新增 ${insertedOrders} 条`);

      const bills = await this.fetchAll(client, 'bills', window, log);
      let insertedBills = 0;
      for (const b of bills) {
        const bizId = b.billId || `${b.businessType}-${b.cTime}-${b.amount}`;
        const exists = await this.prisma.ledger.findUnique({
          where: { accountId_bizId: { accountId: acc.id, bizId } },
        });
        if (exists) continue;

        let type = 'OTHER';
        if (isFundingBill(b)) type = 'FUNDING';
        else if (isTransferBill(b)) type = Number(b.amount) >= 0 ? 'TRANSFER_IN' : 'TRANSFER_OUT';

        await this.prisma.ledger.create({
          data: {
            accountId: acc.id,
            type,
            amount: b.amount,
            coin: b.coin,
            symbol: b.symbol ?? null,
            bizId,
            occurredAt: new Date(b.cTime),
            rawPayload: JSON.stringify(b.raw),
          },
        });
        insertedBills++;
      }
      log(`流水 ${bills.length} 条，新增 ${insertedBills} 条`);

      // 持仓历史：杠杆 / 保证金 / 强平价只能从这里拿
      let insertedPositions = 0;
      try {
        const positions = await this.fetchAll(client, 'positions', window, log);
        for (const p of positions) {
          if (!p.symbol) continue;
          const pid = p.positionId || `${p.symbol}-${p.cTime}`;
          await this.prisma.position.upsert({
            where: { accountId_positionId: { accountId: acc.id, positionId: pid } },
            create: {
              accountId: acc.id,
              positionId: pid,
              symbol: p.symbol,
              holdSide: p.holdSide,
              marginMode: p.marginMode ?? null,
              leverage: p.leverage ?? null,
              marginSize: p.marginSize ?? null,
              openAvgPrice: p.openAvgPrice ?? null,
              closeAvgPrice: p.closeAvgPrice ?? null,
              totalQty: p.totalQty ?? null,
              liquidatePrice: p.liquidatePrice ?? null,
              pnl: p.pnl ?? null,
              netProfit: p.netProfit ?? null,
              totalFunding: p.totalFunding ?? null,
              openTime: new Date(p.cTime || Date.now()),
              closeTime: p.uTime ? new Date(p.uTime) : null,
              rawPayload: JSON.stringify(p.raw),
            },
            update: {
              leverage: p.leverage ?? null,
              marginSize: p.marginSize ?? null,
              marginMode: p.marginMode ?? null,
              liquidatePrice: p.liquidatePrice ?? null,
              closeTime: p.uTime ? new Date(p.uTime) : null,
              rawPayload: JSON.stringify(p.raw),
            },
          });
          insertedPositions++;
        }
        log(`持仓历史 ${positions.length} 条，写入 ${insertedPositions} 条（用于回填杠杆与保证金）`);
      } catch (e: any) {
        log(`持仓历史读取失败，杠杆/保证金将留空：${e.message}`, 'warn');
      }

      // 当前持仓：UTA 里唯一带 leverage / marginSize 的接口
      try {
        const holding = await client.currentPositions();
        for (const p of holding) {
          if (!p.symbol) continue;
          const pid = p.positionId || `${p.symbol}-${p.holdSide}-open`;
          await this.prisma.position.upsert({
            where: { accountId_positionId: { accountId: acc.id, positionId: pid } },
            create: {
              accountId: acc.id,
              positionId: pid,
              symbol: p.symbol,
              holdSide: p.holdSide,
              marginMode: p.marginMode ?? null,
              leverage: p.leverage ?? null,
              marginSize: p.marginSize ?? null,
              openAvgPrice: p.openAvgPrice ?? null,
              closeAvgPrice: p.closeAvgPrice ?? null,
              totalQty: p.totalQty ?? null,
              liquidatePrice: p.liquidatePrice ?? null,
              pnl: p.pnl ?? null,
              netProfit: p.netProfit ?? null,
              totalFunding: p.totalFunding ?? null,
              openTime: new Date(p.cTime || Date.now()),
              closeTime: null,
              rawPayload: JSON.stringify(p.raw),
            },
            update: {
              leverage: p.leverage ?? null,
              marginSize: p.marginSize ?? null,
              marginMode: p.marginMode ?? null,
              liquidatePrice: p.liquidatePrice ?? null,
              totalQty: p.totalQty ?? null,
              rawPayload: JSON.stringify(p.raw),
            },
          });
        }
        log(`当前持仓 ${holding.length} 条${holding.length > 0 ? '，已同步杠杆/保证金' : '（无未平仓，历史单的杠杆/保证金交易所不提供）'}`);
      } catch (e: any) {
        log(`当前持仓读取失败：${e.message}`, 'warn');
      }

      const matchResult = await this.matching.rebuild(acc.id);
      log(
        `配对完成：平仓 ${matchResult.closed} 笔，持仓中 ${matchResult.open} 笔，恢复历史复盘 ${matchResult.preservedReviews} 笔`,
      );

      // 权益杠杆：交易所不给历史杠杆，用「名义 / 开仓时权益」估算，交易所真值优先
      try {
        const lev = await this.leverage.estimate({ accountId: acc.id });
        log(
          `权益杠杆推算：估算 ${lev.estimated} 笔，保留交易所值 ${lev.keptExchange} 笔` +
            (lev.skippedNoEquity > 0 ? `，权益非正跳过 ${lev.skippedNoEquity} 笔` : ''),
        );
      } catch (e: any) {
        log(`权益杠杆推算失败：${e.message}`, 'warn');
      }

      await this.prisma.account.update({ where: { id: acc.id }, data: { lastSyncAt: new Date() } });
      await this.finish(job.id, 'SUCCESS', logs, {
        posModeDetected: info.posMode,
        ordersCount: orders.length,
        fillsCount: fills.length,
        ledgerCount: bills.length,
        insertedCount: insertedFills + insertedOrders + insertedBills + insertedPositions,
      });

      return this.getJob(job.id);
    } catch (e: any) {
      const hint = isUnifiedAccountError(e)
        ? '（这是统一账户与经典账户接口不兼容导致的，系统本应自动切换到 v3；若反复出现请把这条日志发我）'
        : '';
      log(`同步失败：${e.message}${hint}`, 'error');
      await this.finish(job.id, 'FAILED', logs, { errorMessage: `${e.message}${hint}` });
      return this.getJob(job.id);
    } finally {
      this.running.delete(acc.id);
    }
  }

  /**
   * 拉全量。
   * Bitget 对单次查询的时间跨度有限制（经典账户 7 天、统一账户 30 天），
   * 所以先按 maxWindowDays 切片，再在每个窗口内用游标翻页。
   */
  private async fetchAll(
    client: BitgetApi,
    kind: 'fills' | 'orders' | 'bills' | 'positions',
    window: FetchRange,
    log: (m: string, l?: LogLevel) => void,
  ): Promise<any[]> {
    const out: any[] = [];
    const maxMs = Math.max(1, client.maxWindowDays) * 86400_000;
    let winStart = window.startTime;
    let page = 0;
    let winIndex = 0;

    while (winStart <= window.endTime) {
      const winEnd = Math.min(winStart + maxMs - 1, window.endTime);
      winIndex++;
      let cursor: string | undefined;

      for (;;) {
        page++;
        const res = await (client[kind] as any)({ ...window, startTime: winStart, endTime: winEnd, cursor });
        out.push(...res.items);
        log(
          `${kind} 第 ${winIndex} 段第 ${page} 页：${res.items.length} 条${res.hasMore ? '，继续翻页' : '，本段结束'}`,
        );
        if (!res.hasMore || !res.cursor || page >= 300) break;
        cursor = res.cursor;
      }

      winStart = winEnd + 1;
    }
    return out;
  }

  private async finish(
    id: string,
    status: string,
    logs: { t: string; level: LogLevel; msg: string }[],
    extra: Record<string, any>,
  ) {
    await this.prisma.syncJob.update({
      where: { id },
      data: {
        status,
        completedAt: new Date(),
        logs: logs.map((l) => JSON.stringify(l)).join('\n'),
        ...extra,
      },
    });
  }

  /**
   * 清空同步数据（不动人工录入的交易与复盘）。
   * 用途：重新同步前清场、或试跑 Mock 数据后还原。
   */
  async resetSyncData() {
    const acc = await this.accounts.ensureDefault();
    const deletedTrades = await this.prisma.trade.deleteMany({
      where: { accountId: acc.id, matchingStatus: 'AUTO_MATCHED' },
    });
    const deletedFills = await this.prisma.fill.deleteMany({ where: { accountId: acc.id } });
    const deletedOrders = await this.prisma.order.deleteMany({ where: { accountId: acc.id } });
    const deletedLedger = await this.prisma.ledger.deleteMany({ where: { accountId: acc.id } });
    const deletedJobs = await this.prisma.syncJob.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.account.update({ where: { id: acc.id }, data: { lastSyncAt: null } });
    return {
      trades: deletedTrades.count,
      fills: deletedFills.count,
      orders: deletedOrders.count,
      ledger: deletedLedger.count,
      jobs: deletedJobs.count,
    };
  }

  /**
   * 清空全部交易数据（含手工录入与演示数据），保留账户、策略、标签。
   * 用于「重新导入」的场景：先清场，避免新旧数据混在一起。
   */
  async purgeAllData() {
    const acc = await this.accounts.ensureDefault();
    const trades = await this.prisma.trade.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.fill.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.order.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.ledger.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.syncJob.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.equitySnapshot.deleteMany({ where: { accountId: acc.id } });
    await this.prisma.account.update({ where: { id: acc.id }, data: { lastSyncAt: null } });
    const kept = {
      strategies: await this.prisma.strategy.count({ where: { accountId: acc.id } }),
      tags: await this.prisma.tag.count({ where: { accountId: acc.id } }),
    };
    this.logger.warn(`已清空全部交易数据：${trades.count} 笔交易`);
    return { trades: trades.count, keptStrategies: kept.strategies, keptTags: kept.tags };
  }

  async listJobs() {    const acc = await this.accounts.ensureDefault();
    return this.prisma.syncJob.findMany({
      where: { accountId: acc.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getJob(id: string) {
    const job = await this.prisma.syncJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('同步任务不存在');
    return {
      ...job,
      logLines: (job.logs ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { t: '', level: 'info', msg: line };
          }
        }),
    };
  }
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** 把底层网络/接口异常翻译成人能看懂的结论 */
function describeError(e: any): string {
  const msg = String(e?.message ?? e);
  const code = e?.code ?? '';
  if (/startTime/i.test(msg) && /90/.test(msg)) {
    return '起始时间超出交易所限制（最多回溯 90 天）。请把开始日期改到 90 天内再同步。';
  }
  if (/signature error|40009/i.test(msg)) {
    return (
      '签名不匹配（sign signature error）。99% 是 Secret Key 填错：' +
      'Bitget 的 Secret 通常是 32 位以上的一长串，请回 API 管理页重新复制；' +
      '另外确认创建 Key 时选的是 HMAC 而不是 RSA，本系统只支持 HMAC。'
    );
  }
  if (msg.includes('fetch failed') || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || msg.includes('timeout')) {
    return '无法连接到 api.bitget.com（网络层问题，不是密钥问题）';
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return '请求超时（10 秒无响应）。通常是网络被拦截或延迟过高。';
  }
  return msg;
}

/**
 * 保存前做基础校验。
 * 不为难用户，只拦那些"一眼就知道填错了"的情况——
 * 之前填错的密钥被存进去，最后表现为一个看不懂的 40009。
 */
function validateCredentials(c: { apiKey: string; secret: string; passphrase: string }) {
  if (c.apiKey.length < 10) {
    throw new BadRequestException(`API Key 看起来不完整（只有 ${c.apiKey.length} 位）。请重新从 Bitget 复制。`);
  }
  if (c.secret.length < 20) {
    throw new BadRequestException(
      `Secret Key 看起来不完整（只有 ${c.secret.length} 位，通常 32 位以上）。` +
        '常见原因：复制时漏了、复制成了 API Key、或者填成了登录密码。',
    );
  }
  if (c.secret === c.passphrase) {
    throw new BadRequestException(
      'Secret Key 和 Passphrase 填成了同一个值。这两个是不同的东西：' +
        'Secret 是 Bitget 生成的，Passphrase 是你创建 Key 时自己设的。',
    );
  }
  if (c.passphrase.length < 6 || c.passphrase.length > 32) {
    throw new BadRequestException(`Passphrase 长度异常（${c.passphrase.length} 位），一般是 8–32 位。`);
  }
}
