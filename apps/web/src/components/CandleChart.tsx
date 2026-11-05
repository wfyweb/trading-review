import { useEffect, useRef, useState } from 'react';
import { C } from '../lib/colors';

export interface CandlePoint {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface Props {
  candles: CandlePoint[];
  direction: 'LONG' | 'SHORT';
  entryPrice: string;
  exitPrice?: string | null;
  stopPrice?: string | null;
  mfe?: { pct: string; at: string } | null;
  mae?: { pct: string; at: string } | null;
  entryTime?: string;
  exitTime?: string | null;
}

const PAD = { top: 16, right: 58, bottom: 22, left: 8 };
const HEIGHT = 300;
/** 无对应主题变量的辅助色 */
const AMBER = '#b08d57';

/** 估算文本像素宽度：中文字宽约 9.6px，ASCII 约 5.6px（9.5px 等宽字体） */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 9.6 : 5.6;
  return w;
}


/**
 * 零依赖 K 线图（SVG 手绘）。
 * 刻意不用图表库：需求固定（蜡烛 + 开平仓线 + 止损线 + MFE/MAE 标注），
 * 引一个库的成本比画这几条线高。
 */
export function CandleChart({ candles, direction, entryPrice, exitPrice, stopPrice, mfe, mae }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (candles.length === 0) {
    return (
      <div className="empty" style={{ padding: '28px 0' }}>
        无 K 线数据（可能未拉取，或超出交易所历史深度）
      </div>
    );
  }

  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const volH = 42;

  const prices = candles.flatMap((c) => [Number(c.high), Number(c.low)]);
  const extras = [entryPrice, exitPrice, stopPrice].filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  let min = Math.min(...prices, ...extras);
  let max = Math.max(...prices, ...extras);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = min - 1;
    max = max + 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const xOf = (i: number) => PAD.left + (candles.length === 1 ? plotW / 2 : (i / (candles.length - 1)) * plotW);
  const yOf = (p: number) => PAD.top + ((max - p) / (max - min)) * (plotH - volH - 8);

  const bodyW = Math.max(1, Math.min(9, (plotW / candles.length) * 0.66));

  const maxVol = Math.max(...candles.map((c) => Number(c.volume) || 0), 1);
  const volY = PAD.top + plotH - volH;

  const lineY = (p: number) => yOf(p);
  const fmt = (p: number) => {
    const abs = Math.abs(p);
    const dp = abs >= 1000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
    return p.toFixed(dp);
  };

  // MFE/MAE 极值点：按时间戳找最近的一根 K 线定位 x
  const findX = (iso?: string) => {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    let best = 0;
    let bestDiff = Infinity;
    candles.forEach((c, i) => {
      const d = Math.abs(c.openTime - ts);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    });
    return xOf(best);
  };
  const mfeX = findX(mfe?.at);
  const maeX = findX(mae?.at);

  const ticks = 4;
  const priceTicks = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);

  /**
   * 水平价线：开仓 / 平仓 / 止损。
   * 价格接近时标签会叠在一起，这里按 y 排序后强制留出 13px 间距，
   * 并用一小段引线连回真实价格位置。
   */
  const lines = [
    { price: Number(entryPrice), label: `开仓 ${fmt(Number(entryPrice))}`, color: direction === 'LONG' ? C.accent : AMBER, dashed: false },
    ...(exitPrice && Number.isFinite(Number(exitPrice))
      ? [{ price: Number(exitPrice), label: `平仓 ${fmt(Number(exitPrice))}`, color: C.t2, dashed: true }]
      : []),
    ...(stopPrice && Number.isFinite(Number(stopPrice))
      ? [{ price: Number(stopPrice), label: `止损 ${fmt(Number(stopPrice))}`, color: AMBER, dashed: true }]
      : []),
  ]
    .map((l) => ({ ...l, y: lineY(l.price), labelY: lineY(l.price) }))
    .sort((a, b) => a.y - b.y);

  const MIN_GAP = 13;
  const topBound = PAD.top + 2;
  const bottomBound = PAD.top + plotH - volH - 12;

  // 先自上而下推开
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].labelY - lines[i - 1].labelY < MIN_GAP) lines[i].labelY = lines[i - 1].labelY + MIN_GAP;
  }
  // 触底则自下而上回推，而不是整体平移（整体平移会把间距重新压回去）
  if (lines.length > 0 && lines[lines.length - 1].labelY > bottomBound) {
    lines[lines.length - 1].labelY = bottomBound;
    for (let i = lines.length - 2; i >= 0; i--) {
      if (lines[i + 1].labelY - lines[i].labelY < MIN_GAP) lines[i].labelY = lines[i + 1].labelY - MIN_GAP;
    }
  }
  if (lines.length > 0 && lines[0].labelY < topBound) lines[0].labelY = topBound;

  const clampX = (x: number) => Math.min(PAD.left + plotW - 34, Math.max(PAD.left + 34, x));

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg width={width} height={HEIGHT} style={{ display: 'block', overflow: 'visible' }}>
        {/* 网格与价格轴 */}
        {priceTicks.map((p, i) => (
          <g key={`pt${i}`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={lineY(p)} y2={lineY(p)} stroke={C.border} strokeWidth={1} strokeDasharray="2 4" opacity={0.55} />
            <text x={PAD.left + plotW + 6} y={lineY(p) + 3.5} fill={C.t3} fontSize={9.5} fontFamily="ui-monospace, monospace">
              {fmt(p)}
            </text>
          </g>
        ))}

        {/* 成交量 */}
        {candles.map((c, i) => {
          const h = (Number(c.volume) / maxVol) * (volH - 4);
          const up = Number(c.close) >= Number(c.open);
          return (
            <rect
              key={`v${i}`}
              x={xOf(i) - bodyW / 2}
              y={volY + (volH - 4 - h) + 4}
              width={bodyW}
              height={Math.max(0.5, h)}
              fill={up ? C.pos : C.neg}
              opacity={0.22}
            />
          );
        })}

        {/* 蜡烛 */}
        {candles.map((c, i) => {
          const o = Number(c.open);
          const cl = Number(c.close);
          const hi = Number(c.high);
          const lo = Number(c.low);
          const up = cl >= o;
          const color = up ? C.pos : C.neg;
          const x = xOf(i);
          const yO = yOf(o);
          const yC = yOf(cl);
          return (
            <g key={`c${i}`}>
              <line x1={x} x2={x} y1={yOf(hi)} y2={yOf(lo)} stroke={color} strokeWidth={1} />
              <rect
                x={x - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(1, Math.abs(yC - yO))}
                fill={color}
                opacity={up ? 0.85 : 0.9}
              />
            </g>
          );
        })}

        {/* 开仓 / 平仓 / 止损线（标签位置做过避让） */}
        {lines.map((l, i) => (
          <g key={`pl${i}`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={1} strokeDasharray={l.dashed ? '4 3' : undefined} opacity={0.85} />
            {Math.abs(l.labelY - l.y) > 0.6 && (
              <line x1={PAD.left + 3} x2={PAD.left + 11} y1={l.y} y2={l.labelY} stroke={l.color} strokeWidth={0.8} opacity={0.6} />
            )}
            <rect
              x={PAD.left + 3}
              y={l.labelY - 8}
              width={textWidth(l.label) + 12}
              height={13}
              rx={2}
              fill={C.surface}
              fillOpacity={0.93}
              stroke={l.color}
              strokeOpacity={0.45}
              strokeWidth={0.8}
            />
            <text x={PAD.left + 8} y={l.labelY + 1.5} fill={l.color} fontSize={9.5} fontFamily="ui-monospace, monospace">
              {l.label}
            </text>
          </g>
        ))}

        {/* MFE / MAE 极值标记（标签贴边时向内收，避免被裁掉） */}
        {mfe && mfeX !== null && (
          <g>
            <circle cx={mfeX} cy={PAD.top + 8} r={3} fill={C.accent} />
            <text x={clampX(mfeX)} y={PAD.top - 4} fill={C.accent} fontSize={9.5} textAnchor="middle" fontFamily="ui-monospace, monospace">
              MFE {Number(mfe.pct) > 0 ? '+' : ''}
              {Number(mfe.pct).toFixed(2)}%
            </text>
          </g>
        )}
        {mae && maeX !== null && (
          <g>
            <circle cx={maeX} cy={PAD.top + 8} r={3} fill={AMBER} />
            <text x={clampX(maeX)} y={PAD.top + 21} fill={AMBER} fontSize={9.5} textAnchor="middle" fontFamily="ui-monospace, monospace">
              MAE {Number(mae.pct).toFixed(2)}%
            </text>
          </g>
        )}

        {/* 时间轴 */}
        {[0, Math.floor(candles.length / 3), Math.floor((candles.length * 2) / 3), candles.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i && v >= 0)
          .map((i) => {
            const d = new Date(candles[i].openTime);
            const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return (
              <text key={`t${i}`} x={xOf(i)} y={HEIGHT - 6} fill={C.t3} fontSize={9.5} textAnchor="middle" fontFamily="ui-monospace, monospace">
                {label}
              </text>
            );
          })}
      </svg>
    </div>
  );
}
