import { useEffect, useState } from 'react';
import { api, type Filters, type TagStat } from '../lib/api';
import { signed, pnlClass, ratioToPct } from '../lib/format';
import { ErrorCard, Loading } from './Overview';

/**
 * 归因分组参考《交易策略》文档：
 * 亏损要么来自「判断错」（方向/环境/位置），要么来自「执行错」（追涨/扛单/过早止盈），
 * 要么来自「成本」（手续费/滑点）。三类问题的解法完全不同，不能混在一起看。
 */
const GROUPS: { key: string; label: string; desc: string; includes: string[] }[] = [
  { key: 'JUDGMENT', label: '判断类', desc: '方向、环境、强弱、位置判断错了 —— 要改方法', includes: ['JUDGMENT'] },
  { key: 'EXECUTION', label: '执行类', desc: '判断可能没错，但没按计划做 —— 要改纪律', includes: ['EXECUTION', 'MISTAKE'] },
  { key: 'COST', label: '成本类', desc: '手续费、滑点吃掉利润 —— 要改频率和品种', includes: ['COST'] },
  { key: 'POSITIVE', label: '做对了', desc: '这些行为带来正期望，应固化为规则', includes: ['POSITIVE'] },
  { key: 'MARKET', label: '行情环境', desc: '不同行情下的表现差异', includes: ['MARKET'] },
  { key: 'SETUP', label: '形态', desc: '形态级别的胜率', includes: ['SETUP'] },
];

export function TagsPage({ filters }: { filters: Filters }) {
  const [list, setList] = useState<TagStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .tagStats(filters)
      .then(setList)
      .catch((e) => setErr(e.message));
  }, [JSON.stringify(filters)]);

  if (err) return <ErrorCard message={err} />;
  if (!list) return <Loading />;

  const used = list.filter((t) => t.closedCount > 0);

  return (
    <div className="page">
      <div className="banner" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)', color: 'var(--text-2)' }}>
        <strong style={{ color: 'var(--text)' }}>读法</strong>
        <span className="vline" style={{ background: 'var(--border-strong)' }} />
        <span>
          先看「每笔期望」，再看「判定」。<b>负向标签的平均每笔仍在赚钱</b>，说明它还没成为主要亏损来源；反过来，正向标签的期望若是负的，那只是自我安慰。
        </span>
      </div>

      {GROUPS.map((g) => {
        const items = used.filter((t) => g.includes.includes(t.category));
        if (!items.length) return null;
        const sum = items.reduce((a, t) => a + Number(t.netPnl), 0);
        return (
          <div className="card" key={g.key}>
            <div className="card-hd">
              <h2>{g.label}</h2>
              <span className="hint">{g.desc}</span>
              <div className="spacer" />
              <span className={`mono ${pnlClass(sum)}`} style={{ fontSize: 12 }}>
                {signed(sum.toFixed(4), 2)} U
              </span>
            </div>
            <div className="card-bd tight">
              <table className="table">
                <thead>
                  <tr>
                    <th>标签</th>
                    <th className="num">出现次数</th>
                    <th className="num">胜率</th>
                    <th className="num">每笔期望</th>
                    <th className="num">累计净收益</th>
                    <th>判定</th>
                    <th style={{ width: '20%' }}>胜负分布</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => {
                    const winW = t.closedCount ? (t.winCount / t.closedCount) * 100 : 0;
                    const avg = Number(t.avgNetPnl ?? 0);
                    const verdict =
                      t.polarity === 'NEGATIVE'
                        ? avg < 0
                          ? { label: '确实在亏', cls: 'danger' }
                          : { label: '暂未亏钱', cls: 'warn' }
                        : t.polarity === 'POSITIVE'
                          ? avg > 0
                            ? { label: '确实有效', cls: 'acc' }
                            : { label: '没帮上忙', cls: 'warn' }
                          : { label: '中性', cls: '' };
                    return (
                      <tr key={t.id} style={{ cursor: 'default' }}>
                        <td>
                          <span
                            className="tag"
                            style={{
                              color: t.polarity === 'POSITIVE' ? 'var(--neg)' : t.polarity === 'NEGATIVE' ? 'var(--pos)' : 'var(--text-2)',
                              background: t.polarity === 'POSITIVE' ? 'var(--neg-soft)' : t.polarity === 'NEGATIVE' ? 'var(--pos-soft)' : 'var(--surface-2)',
                              fontSize: 11,
                              padding: '2px 7px',
                            }}
                          >
                            {t.name}
                          </span>
                        </td>
                        <td className="num">{t.closedCount}</td>
                        <td className="num">{ratioToPct(t.winRate, 0)}</td>
                        <td className={`num ${pnlClass(t.avgNetPnl)}`}>{signed(t.avgNetPnl, 3)}</td>
                        <td className={`num ${pnlClass(t.netPnl)}`}>{signed(t.netPnl, 3)}</td>
                        <td>
                          <span className={`chip ${verdict.cls}`}>{verdict.label}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-2)' }}>
                            <div style={{ width: `${winW}%`, background: 'var(--pos)', opacity: 0.75 }} title={`${t.winCount} 胜`} />
                            <div style={{ width: `${100 - winW}%`, background: 'var(--neg)', opacity: 0.65 }} title={`${t.lossCount} 负`} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {used.length === 0 && (
        <div className="card">
          <div className="empty">当前区间没有带标签的交易</div>
        </div>
      )}

      <div className="card">
        <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12.5 }}>归因原则</div>
          <div className="steps">
            <div>
              <span className="n">1</span>一笔亏损只打<b>一个主因</b>标签。打三个标签等于没归因。
            </div>
            <div>
              <span className="n">2</span>先分清是「判断错」还是「执行错」——前者改方法，后者改纪律，混在一起会两头都改不好。
            </div>
            <div>
              <span className="n">3</span>没有标签的亏损无法被解释，也不会进入任何统计结论。至少给它一个原因。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
