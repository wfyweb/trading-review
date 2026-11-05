import { useEffect, useState } from 'react';
import { api, type Concentration, type DirectionStat, type Filters, type HoldingBucket, type StrategyStat } from '../lib/api';
import { num, signed, pnlClass, ratioToPct, duration } from '../lib/format';
import { ErrorCard, Loading } from './Overview';

const BUCKET_VERDICT: Record<string, { label: string; cls: string }> = {
  PROFITABLE: { label: '赚钱', cls: 'acc' },
  MARGINAL: { label: '勉强', cls: 'warn' },
  LOSING: { label: '亏钱', cls: 'danger' },
  INSUFFICIENT: { label: '样本不足', cls: '' },
};

const STABILITY: Record<string, { label: string; cls: string }> = {
  ROBUST: { label: '分布均匀', cls: 'acc' },
  CONCENTRATED: { label: '较集中', cls: 'warn' },
  EXTREME: { label: '极度集中', cls: 'danger' },
  INSUFFICIENT: { label: '样本不足', cls: '' },
};

export function StrategiesPage({ filters }: { filters: Filters }) {
  const [list, setList] = useState<StrategyStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<HoldingBucket[]>([]);
  const [conc, setConc] = useState<Concentration | null>(null);
  const [dirs, setDirs] = useState<DirectionStat[]>([]);

  const [strategies, setStrategies] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState('');
  const [gte, setGte] = useState('30');
  const [lte, setLte] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [preview, setPreview] = useState<{ matched: number; sample: any[] } | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    api
      .strategyStats(filters)
      .then(setList)
      .catch((e) => setErr(e.message));
    api
      .breakdown(filters)
      .then((b) => {
        setBuckets(b.holdingBuckets);
        setConc(b.concentration);
        setDirs(b.directionSplit);
      })
      .catch(() => {});
    api.strategies().then(setStrategies).catch(() => {});
  };

  useEffect(load, [JSON.stringify(filters)]);

  const buildBody = (dryRun: boolean) => ({
    filter: filters,
    strategyId: target,
    holdingMinGte: gte || undefined,
    holdingMinLte: lte || undefined,
    onlyUnassigned,
    dryRun,
  });

  const doPreview = async () => {
    setNotice(null);
    try {
      const r = await api.batchStrategy(buildBody(true));
      setPreview({ matched: r.matched, sample: r.sample });
    } catch (e: any) {
      setNotice(`预览失败：${e.message}`);
    }
  };

  const doApply = async () => {
    if (!target) {
      setNotice('请先选择目标策略');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.batchStrategy(buildBody(false));
      setNotice(`已归类 ${r.updated} 笔`);
      setPreview(null);
      load();
    } catch (e: any) {
      setNotice(`归类失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const createStrategy = async () => {
    if (!newName.trim()) return;
    try {
      const s = await api.createStrategy({ name: newName.trim() });
      setNewName('');
      setTarget(s.id);
      const all = await api.strategies();
      setStrategies(all);
      setNotice(`已创建策略「${s.name}」`);
    } catch (e: any) {
      setNotice(`创建失败：${e.message}`);
    }
  };

  if (err) return <ErrorCard message={err} />;
  if (!list) return <Loading />;

  const maxAbs = Math.max(...list.map((s) => Math.abs(Number(s.netPnl))), 0.01);

  return (
    <div className="page">
      <div className="banner" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)', color: 'var(--text-2)' }}>
        <strong style={{ color: 'var(--text)' }}>判定分三步</strong>
        <span className="vline" style={{ background: 'var(--border-strong)' }} />
        <span>
          ① 样本 ≥ 20 才下结论 ② 期望值为负 → 需重新评估 ③ 期望为正、但最好的 5% 交易贡献超过 80% 利润 → <b>靠少数单撑</b>，不算成熟策略
        </span>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>快速归类</h2>
          <span className="hint">先按规则把历史交易打上策略，下面的统计才有意义</span>
        </div>
        <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field-block" style={{ width: 120 }}>
              <label>持仓 ≥（分钟）</label>
              <input className="input" value={gte} onChange={(e) => setGte(e.target.value)} placeholder="30" />
            </div>
            <div className="field-block" style={{ width: 120 }}>
              <label>持仓 ≤（分钟）</label>
              <input className="input" value={lte} onChange={(e) => setLte(e.target.value)} placeholder="不限" />
            </div>
            <div className="field-block" style={{ minWidth: 160 }}>
              <label>归为策略</label>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">请选择…</option>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
              只处理未归类
            </label>
            <div className="spacer" />
            <button className="btn" onClick={doPreview}>
              预览命中
            </button>
            <button className="btn primary" onClick={doApply} disabled={busy || !target}>
              {busy ? '写入中…' : '执行归类'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 11 }}>没有合适的策略？</span>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="新建策略名，如：趋势跟随"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="btn ghost" onClick={createStrategy} disabled={!newName.trim()}>
              新建
            </button>
          </div>

          {preview && (
            <div className="banner" style={{ borderColor: 'rgba(64,229,240,.28)', background: 'rgba(64,229,240,.06)', color: 'var(--text)' }}>
              <strong>命中 {preview.matched} 笔</strong>
              <span className="vline" style={{ background: 'rgba(64,229,240,.2)' }} />
              <span className="muted" style={{ fontSize: 11.5 }}>
                {preview.sample
                  .slice(0, 3)
                  .map((s) => `${s.symbol} ${s.direction === 'LONG' ? '多' : '空'} ${s.holdingMinutes}分`)
                  .join('　')}
                {preview.matched > 3 ? ' …' : ''}
              </span>
            </div>
          )}

          {notice && <div className="banner">{notice}</div>}

          <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
            按你 144 笔的实际情况，建议这样切：
            <b>持仓 ≥ 30 分钟 → 趋势跟随</b>（这批赚了 2,306）；<b>持仓 &lt; 30 分钟 → 短线动量</b>（这批亏了 4,673）。
            这样切完再去下面看两个策略的期望值差多少。
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>按持仓时长拆解</h2>
          <span className="hint">短线到底赚不赚钱，看这一张就够了</span>
        </div>
        <div className="card-bd tight">
          <table className="table">
            <thead>
              <tr>
                <th>持仓区间</th>
                <th className="num">笔数</th>
                <th className="num">占比</th>
                <th className="num">胜率</th>
                <th className="num">净收益</th>
                <th className="num">每笔期望</th>
                <th className="num">手续费/毛利</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key} style={{ cursor: 'default' }}>
                  <td>{b.label}</td>
                  <td className="num">{b.count}</td>
                  <td className="num muted">{b.share ? `${(Number(b.share) * 100).toFixed(0)}%` : '—'}</td>
                  <td className="num">{ratioToPct(b.winRate, 0)}</td>
                  <td className={`num ${pnlClass(b.netPnl)}`}>{signed(b.netPnl, 3)}</td>
                  <td className={`num ${pnlClass(b.expectancy)}`}>{signed(b.expectancy, 3)}</td>
                  <td className={`num ${Number(b.feeToGross ?? 0) > 0.5 ? 'neg' : 'muted'}`}>
                    {b.feeToGross ? `${(Number(b.feeToGross) * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td>
                    <span className={`chip ${BUCKET_VERDICT[b.verdict]?.cls ?? ''}`}>{BUCKET_VERDICT[b.verdict]?.label ?? b.verdict}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-bd" style={{ paddingTop: 10 }}>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
            「每笔期望」是扣完手续费的净值。若 0–5 分钟那一行是负的，说明这类交易越做越亏，要么减少频率，要么提高单笔目标波动幅度。
          </div>
        </div>
      </div>

      {conc && (
        <div className="grid g-8-4">
          <div className="card">
            <div className="card-hd">
              <h2>收益集中度</h2>
              <span className="hint">利润是不是只靠几笔大单</span>
              <div className="spacer" />
              <span className={`chip ${STABILITY[conc.stability]?.cls ?? ''}`}>{STABILITY[conc.stability]?.label ?? conc.stability}</span>
            </div>
            <div className="card-bd" style={{ paddingTop: 8 }}>
              <div className="grid g4" style={{ gap: 10, marginBottom: 10 }}>
                <Mini label="已平仓" value={`${conc.sampleSize}`} />
                <Mini label="盈利笔数" value={`${conc.profitableCount}`} />
                <Mini label="前 5% 贡献" value={conc.top5Share ? `${(Number(conc.top5Share) * 100).toFixed(0)}%` : '—'} cls={Number(conc.top5Share ?? 0) > 0.8 ? 'neg' : undefined} />
                <Mini label="剔除后净收益" value={signed(conc.netWithoutTop5, 3)} cls={pnlClass(conc.netWithoutTop5)} />
              </div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                {conc.note}。前 1% 交易贡献 {conc.top1Share ? `${(Number(conc.top1Share) * 100).toFixed(0)}%` : '—'}，前 5% 贡献{' '}
                {conc.top5Share ? `${(Number(conc.top5Share) * 100).toFixed(0)}%` : '—'}（占全部盈利之和）。
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h2>多空对比</h2>
              <span className="hint">偏好是否在拖累你</span>
            </div>
            <div className="card-bd" style={{ paddingTop: 8 }}>
              {dirs.map((d) => (
                <div key={d.direction} style={{ marginBottom: 10 }}>
                  <div className="stat-row" style={{ paddingTop: 0 }}>
                    <span>
                      <span className={`chip ${d.direction === 'LONG' ? 'long' : 'short'}`}>{d.direction === 'LONG' ? '多' : '空'}</span>{' '}
                      {d.count} 笔 · 占 {(Number(d.share) * 100).toFixed(0)}%
                    </span>
                    <span className={`mono ${pnlClass(d.netPnl)}`}>{signed(d.netPnl, 3)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    胜率 {ratioToPct(d.winRate, 1)}｜每笔期望 {signed(d.expectancy, 3)}｜均盈 {num(d.avgWin, 2)} / 均亏 {num(d.avgLoss, 2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid g2">
        {list.map((s) => (
          <div className="card" key={s.strategyId ?? 'none'}>
            <div className="card-hd">
              <h2>{s.name}</h2>
              {s.verdict === 'REASSESS' && <span className="chip danger">需重新评估</span>}
              {s.verdict === 'FRAGILE' && <span className="chip warn">靠少数单撑</span>}
              {s.verdict === 'INSUFFICIENT' && <span className="chip">样本不足</span>}
              {s.verdict === 'OK' && <span className="chip acc">表现正常</span>}
              <div className="spacer" />
              <span className={`mono ${pnlClass(s.netPnl)}`} style={{ fontSize: 16, fontWeight: 500 }}>
                {signed(s.netPnl, 3)} U
              </span>
            </div>
            <div className="card-bd" style={{ paddingTop: 10 }}>
              <div className="grid g4" style={{ gap: 8, marginBottom: 10 }}>
                <Mini label="样本" value={`${s.closedCount}`} />
                <Mini label="胜率" value={ratioToPct(s.winRate, 0)} />
                <Mini label="期望值" value={signed(s.expectancyUsdt, 3)} cls={pnlClass(s.expectancyUsdt)} />
                <Mini label="盈亏比" value={s.profitFactor ? num(s.profitFactor, 2) : '—'} />
              </div>

              <div style={{ display: 'flex', height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 8 }}>
                <div
                  style={{
                    width: `${(Math.abs(Number(s.netPnl)) / maxAbs) * 100}%`,
                    background: Number(s.netPnl) >= 0 ? 'var(--pos)' : 'var(--neg)',
                  }}
                />
              </div>

              <div
                className="muted"
                style={{ fontSize: 11, lineHeight: 1.65, marginBottom: 10, minHeight: 34 }}
                title="判定依据始终显示，避免只给结论不给理由"
              >
                {s.verdictReason}
              </div>

              <div className="stat-row">
                <span>手续费 / 毛利</span>
                <span className={`mono ${Number(s.feeToGross ?? 0) > 0.5 ? 'neg' : ''}`}>
                  {s.feeToGross ? `${(Number(s.feeToGross) * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="stat-row">
                <span>前 5% 交易贡献利润</span>
                <span className={`mono ${Number(s.top5Share ?? 0) > 0.8 ? 'neg' : ''}`}>
                  {s.top5Share ? `${(Number(s.top5Share) * 100).toFixed(0)}%` : '—'}
                </span>
              </div>
              <div className="stat-row">
                <span>剔除最好 5% 后</span>
                <span className={`mono ${pnlClass(s.netWithoutTop5)}`}>{signed(s.netWithoutTop5, 3)}</span>
              </div>
              <div className="stat-row">
                <span>R 期望</span>
                <span className="mono">
                  {s.expectancyR ? num(s.expectancyR, 2) : '—'} <span className="muted">（样本 {s.rSampleSize}）</span>
                </span>
              </div>
              <div className="stat-row">
                <span>累计 R</span>
                <span className="mono">{num(s.totalR, 1)}</span>
              </div>
              <div className="stat-row">
                <span>手续费</span>
                <span className="mono">{num(s.totalFee, 3)} U</span>
              </div>
              <div className="stat-row">
                <span>平均持仓</span>
                <span className="mono">{duration(s.avgHoldingSeconds)}</span>
              </div>

              {s.rules && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--text-3)' }}>策略规则</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--text-2)', marginTop: 6, fontFamily: 'var(--sans)' }}>
                    {s.rules}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10 }}>{label}</div>
      <div className={`mono ${cls ?? ''}`} style={{ fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}
