import { useEffect, useState } from 'react';
import { api, type Filters, type Performance, type Strategy, type Trade } from '../lib/api';
import { num, signed, pnlClass, dt, duration, ratioToPct, priceDp } from '../lib/format';
import { go } from '../lib/router';
import { TradeFormModal } from '../components/TradeFormModal';
import { CsvImportModal } from '../components/CsvImportModal';
import { ErrorCard, Loading } from './Overview';

export function TradesPage({ filters }: { filters: Filters }) {
  const [rows, setRows] = useState<Trade[]>([]);
  const [summary, setSummary] = useState<Performance | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [local, setLocal] = useState<Filters>({ direction: '', strategyId: '', result: '', reviewStatus: '', symbol: '', q: '' });
  const [showForm, setShowForm] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const query: Filters = { ...filters, ...local, page: String(page), pageSize: '25' };

  useEffect(() => {
    api.strategies().then(setStrategies).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .trades(query)
      .then((r) => {
        setRows(r.items);
        setSummary(r.summary);
        setTotal(r.total);
        setErr(null);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [JSON.stringify(query), reloadKey]);

  if (err) return <ErrorCard message={err} />;

  const set = (k: string, v: string) => {
    setPage(1);
    setLocal((s) => ({ ...s, [k]: v }));
  };

  // 导出按当前筛选（含顶栏时间范围），不带分页参数
  const doExport = async () => {
    setExporting(true);
    try {
      await api.exportTrades({ ...filters, ...local });
    } catch (e) {
      alert(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="filters card" style={{ padding: '12px 14px' }}>
        <div className="field">
          <label>交易对</label>
          <select className="select" value={local.symbol} onChange={(e) => set('symbol', e.target.value)}>
            <option value="">全部</option>
            {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>方向</label>
          <select className="select" value={local.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="">全部</option>
            <option value="LONG">做多</option>
            <option value="SHORT">做空</option>
          </select>
        </div>
        <div className="field">
          <label>策略</label>
          <select className="select" value={local.strategyId} onChange={(e) => set('strategyId', e.target.value)}>
            <option value="">全部</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>结果</label>
          <select className="select" value={local.result} onChange={(e) => set('result', e.target.value)}>
            <option value="">全部</option>
            <option value="WIN">盈利</option>
            <option value="LOSS">亏损</option>
          </select>
        </div>
        <div className="field">
          <label>复盘状态</label>
          <select className="select" value={local.reviewStatus} onChange={(e) => set('reviewStatus', e.target.value)}>
            <option value="">全部</option>
            <option value="PENDING">待复盘</option>
            <option value="DONE">已完成</option>
          </select>
        </div>
        <div className="field">
          <label>关键词</label>
          <input className="input" placeholder="形态 / 交易对" value={local.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <div className="spacer" />
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 10 }}>筛选结果</div>
          <div className="mono" style={{ fontSize: 13 }}>
            {total} 笔 {summary && <span className={pnlClass(summary.netPnl)}>· {signed(summary.netPnl, 3)} U</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>交易明细</h2>
          <span className="hint">
            {summary && (
              <>
                胜率 {ratioToPct(summary.winRate, 1)} · 盈亏比 {num(summary.profitFactor, 2)} · 手续费 {num(summary.totalFee, 3)} U
              </>
            )}
          </span>
          <div className="spacer" />
          <button className="btn ghost" disabled={exporting} onClick={doExport}>
            {exporting ? '导出中…' : '导出 Excel'}
          </button>
          <button className="btn ghost" onClick={() => setShowCsv(true)}>
            导入 CSV
          </button>
          <button className="btn primary" onClick={() => setShowForm(true)}>
            + 手动录入
          </button>
        </div>

        {loading ? (
          <div className="empty">加载中…</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>开仓时间</th>
                  <th>交易对</th>
                  <th>方向</th>
                  <th>策略</th>
                  <th className="num">入场 / 出场</th>
                  <th className="num">净收益</th>
                  <th className="num">R</th>
                  <th className="num">持仓</th>
                  <th>标签</th>
                  <th className="num">执行分</th>
                  <th>复盘</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} onClick={() => go(`trades/${t.id}`)}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{dt(t.entryTime)}</td>
                    <td>{t.symbol.replace('USDT', '')}<span className="muted" style={{ fontSize: 10 }}>/USDT</span></td>
                    <td>
                      <span className={`chip ${t.direction === 'LONG' ? 'long' : 'short'}`}>{t.direction === 'LONG' ? '多' : '空'}</span>
                    </td>
                    <td className="dim" style={{ fontSize: 11.5 }}>{t.strategy?.name ?? '—'}</td>
                    <td className="num" style={{ fontSize: 11.5 }}>
                      {num(t.entryPrice, priceDp(t.entryPrice))} → {t.exitPrice ? num(t.exitPrice, priceDp(t.exitPrice)) : '持仓中'}
                    </td>
                    <td className={`num ${pnlClass(t.netPnl)}`} style={{ fontWeight: 500 }}>
                      {signed(t.netPnl, 3)}
                      {t.netPnlEstimated && <span title="估算值" style={{ color: 'var(--warn)', marginLeft: 3 }}>≈</span>}
                    </td>
                    <td className="num dim">{t.rMultiple ? num(t.rMultiple, 2) : '—'}</td>
                    <td className="num muted" style={{ fontSize: 11.5 }}>{duration(t.holdingSeconds)}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden' }}>
                      {t.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag.id}
                          className="tag"
                          style={{
                            color: tag.polarity === 'POSITIVE' ? 'var(--neg)' : tag.polarity === 'NEGATIVE' ? 'var(--pos)' : 'var(--text-3)',
                            background: tag.polarity === 'POSITIVE' ? 'var(--neg-soft)' : tag.polarity === 'NEGATIVE' ? 'var(--pos-soft)' : 'var(--surface-2)',
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {t.tags.length > 2 && <span className="muted" style={{ fontSize: 10 }}>+{t.tags.length - 2}</span>}
                    </td>
                    <td className="num">{t.executionScore ?? <span className="muted">—</span>}</td>
                    <td>
                      {t.reviewStatus === 'DONE' ? (
                        <span className="chip acc">已复盘</span>
                      ) : (
                        <span className="chip warn">待复盘</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="empty">没有符合条件的交易</div>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          <span className="muted" style={{ fontSize: 11 }}>
            第 {page} 页 · 共 {Math.max(1, Math.ceil(total / 25))} 页
          </span>
          <div className="spacer" />
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <button className="btn" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 11 }}>
        提示：本页 <b>≈</b> 表示净收益为估算值（手续费或资金费率缺失）；非 USDT 手续费按 0 计入并标记，折算方案待定。
      </div>

      {showForm && (
        <TradeFormModal
          strategies={strategies}
          onClose={() => setShowForm(false)}
          onSaved={(id) => {
            setShowForm(false);
            go(`trades/${id}`);
          }}
        />
      )}

      {showCsv && (
        <CsvImportModal
          strategies={strategies}
          onClose={() => setShowCsv(false)}
          onImported={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
