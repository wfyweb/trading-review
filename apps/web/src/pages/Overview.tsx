import { useEffect, useState } from 'react';
import { api, type EquityPoint, type Filters, type Overview, type StrategyStat, type Trade } from '../lib/api';
import { EquityChart, DrawdownChart } from '../charts';
import { num, pct, ratioToPct, signed, pnlClass, duration, dt } from '../lib/format';
import { go } from '../lib/router';

export function OverviewPage({ filters }: { filters: Filters }) {
  const [data, setData] = useState<Overview | null>(null);
  const [curve, setCurve] = useState<{ points: EquityPoint[]; baselineCapital: string } | null>(null);
  const [strategies, setStrategies] = useState<StrategyStat[]>([]);
  const [pending, setPending] = useState<Trade[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([
      api.overview(filters),
      api.equityCurve(filters),
      api.strategyStats(filters),
      api.trades({ ...filters, reviewStatus: 'PENDING', pageSize: '5' }),
    ])
      .then(([o, c, s, p]) => {
        if (!alive) return;
        setData(o);
        setCurve(c);
        setStrategies(s);
        setPending(p.items);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [JSON.stringify(filters)]);

  if (err) return <ErrorCard message={err} />;
  if (!data || !curve) return <Loading />;

  const q = data.quality;
  const hasQualityIssue = q.estimatedCount + q.feeUnconvertedCount + q.pnlMismatchCount > 0;

  return (
    <div className="page">
      {hasQualityIssue && (
        <div className="banner">
          <strong style={{ fontWeight: 600 }}>数据质量提醒</strong>
          <span className="vline" />
          {q.estimatedCount > 0 && <span>{q.estimatedCount} 笔净收益为估算值</span>}
          {q.feeUnconvertedCount > 0 && (
            <>
              <span className="vline" />
              <span>{q.feeUnconvertedCount} 笔含非 USDT 手续费未折算</span>
            </>
          )}
          {q.pnlMismatchCount > 0 && (
            <>
              <span className="vline" />
              <span>{q.pnlMismatchCount} 笔毛收益与价格差校验不一致</span>
            </>
          )}
          <span className="vline" />
          <span className="muted">这些笔的净收益可能偏离真实值</span>
        </div>
      )}

      <div className="grid g6">
        <Metric
          label="净收益"
          value={signed(data.netPnl, 3)}
          cls={pnlClass(data.netPnl)}
          sub={
            <span>
              收益率 <b className={pnlClass(data.returnPctDisplay)}>{data.returnPctDisplay ? `${Number(data.returnPctDisplay) > 0 ? '+' : ''}${data.returnPctDisplay}%` : '—'}</b> · 本金 {num(data.baselineCapital, 0)}U
            </span>
          }
        />
        <Metric
          label="胜率"
          value={ratioToPct(data.winRate, 1)}
          sub={
            <span>
              {data.winCount} 胜 / {data.lossCount} 负 · 共 {data.closedCount} 笔
            </span>
          }
        />
        <Metric
          label="盈亏比"
          value={data.profitFactor ? num(data.profitFactor, 2) : '—'}
          sub={
            <span>
              均盈 {num(data.avgWin, 2)} / 均亏 {num(data.avgLoss, 2)}
            </span>
          }
        />
        <Metric
          label="期望值"
          value={signed(data.expectancyUsdt, 3)}
          cls={pnlClass(data.expectancyUsdt)}
          sub={
            <span>
              R 期望 {data.expectancyR ? num(data.expectancyR, 2) : '—'} · 样本 {data.rSampleSize}/{data.closedCount}
            </span>
          }
        />
        <Metric
          label="最大回撤"
          value={`${num(data.maxDrawdownPct, 1)}%`}
          cls="neg"
          sub={<span>当前权益 {num(data.finalEquity, 2)} U</span>}
        />
        <Metric
          label="手续费占比"
          value={data.feeRatio ? `${num(data.feeRatio, 1)}%` : '—'}
          cls={Number(data.feeRatio ?? 0) > 40 ? 'neg' : 'dim'}
          sub={<span>累计手续费 {num(data.totalFee, 3)} U</span>}
        />
      </div>

      <div className="grid g-8-4">
        <div className="card">
          <div className="card-hd">
            <h2>权益曲线</h2>
            <span className="hint">基于交易权益（初始资金 + 累计净收益，剔除划转）</span>
            <div className="spacer" />
            <div className="legend">
              <span>
                <i style={{ background: 'var(--pos)' }} />
                权益
              </span>
              <span>
                <i style={{ background: 'var(--text-3)' }} />
                初始 {num(data.baselineCapital, 0)}U
              </span>
            </div>
          </div>
          <div className="card-bd" style={{ paddingBottom: 4 }}>
            <EquityChart points={curve.points} baseline={curve.baselineCapital} />
          </div>
          <div className="card-bd" style={{ paddingTop: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>回撤</div>
            <DrawdownChart points={curve.points} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-hd">
              <h2>数据与风险</h2>
            </div>
            <div className="card-bd" style={{ paddingTop: 8, paddingBottom: 10 }}>
              <Row label="交易笔数" value={`${data.tradeCount} 笔`} />
              <Row label="平均持仓" value={duration(data.avgHoldingSeconds)} />
              <Row label="最大单笔盈利" value={signed(data.bestTrade, 3)} cls="pos" />
              <Row label="最大单笔亏损" value={signed(data.worstTrade, 3)} cls="neg" />
              <Row label="缺开仓止损" value={`${q.missingStopCount} 笔`} cls={q.missingStopCount > 0 ? 'warn' : ''} />
              <Row label="R 覆盖率" value={ratioToPct(data.rCoverage, 0)} />
              <Row label="待确认配对" value={`${q.needsReviewCount} 笔`} cls={q.needsReviewCount > 0 ? 'warn' : ''} />
            </div>
          </div>

          <div className="card" style={{ flex: 1 }}>
            <div className="card-hd">
              <h2>待复盘</h2>
              <span className="hint">按开仓时间倒序</span>
            </div>
            <div className="card-bd" style={{ padding: '6px 12px 12px' }}>
              {pending.length === 0 && <div className="empty" style={{ padding: 18 }}>全部复盘完成</div>}
              {pending.map((t) => (
                <div
                  key={t.id}
                  onClick={() => go(`trades/${t.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 4px',
                    borderBottom: '1px dashed var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <span className={`chip ${t.direction === 'LONG' ? 'long' : 'short'}`}>{t.direction === 'LONG' ? '多' : '空'}</span>
                  <span style={{ fontSize: 12 }}>{t.symbol.replace('USDT', '')}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{dt(t.entryTime)}</span>
                  <span className="spacer" />
                  <span className={`mono ${pnlClass(t.netPnl)}`} style={{ fontSize: 11.5 }}>
                    {signed(t.netPnl, 3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>策略表现</h2>
          <span className="hint">按净收益排序 · 样本 &lt; 20 不下结论</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => go('strategies')}>
            查看详情
          </button>
        </div>
        <div className="card-bd tight">
          <table className="table">
            <thead>
              <tr>
                <th>策略</th>
                <th className="num">样本</th>
                <th className="num">胜率</th>
                <th className="num">净收益</th>
                <th className="num">期望值</th>
                <th className="num">盈亏比</th>
                <th className="num">R 期望</th>
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr key={s.strategyId ?? 'none'} onClick={() => go('strategies')}>
                  <td>{s.name}</td>
                  <td className="num">{s.closedCount}</td>
                  <td className="num">{ratioToPct(s.winRate, 1)}</td>
                  <td className={`num ${pnlClass(s.netPnl)}`}>{signed(s.netPnl, 3)}</td>
                  <td className={`num ${pnlClass(s.expectancyUsdt)}`}>{signed(s.expectancyUsdt, 3)}</td>
                  <td className="num">{s.profitFactor ? num(s.profitFactor, 2) : '—'}</td>
                  <td className="num">{s.expectancyR ? num(s.expectancyR, 2) : '—'}</td>
                  <td>
                    {s.verdict === 'REASSESS' && <span className="chip danger">需重新评估</span>}
                    {s.verdict === 'INSUFFICIENT' && <span className="chip">样本不足</span>}
                    {s.verdict === 'OK' && <span className="chip acc">正常</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, cls }: { label: string; value: string; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${cls ?? ''}`}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span className={`mono ${cls === 'warn' ? '' : cls ?? ''}`} style={cls === 'warn' ? { color: 'var(--warn)' } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="page">
      <div className="banner danger">
        <strong>无法连接本地 API</strong>
        <span className="vline" />
        <span className="muted mono" style={{ fontSize: 11 }}>{message}</span>
      </div>
      <div className="card">
        <div className="card-bd">
          <p className="dim" style={{ marginBottom: 8 }}>请在项目根目录执行：</p>
          <pre className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>pnpm dev:api</pre>
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            首次运行需先初始化数据库：pnpm db:push && pnpm db:seed
          </p>
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="page">
      <div className="grid g6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="metric" key={i}>
            <div className="skeleton" style={{ width: '50%', height: 10 }} />
            <div className="skeleton" style={{ width: '80%', height: 20, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ height: 260 }} />
    </div>
  );
}
