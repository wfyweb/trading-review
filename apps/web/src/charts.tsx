import { useMemo, useRef, useState } from 'react';
import type { EquityPoint } from './lib/api';
import { C } from './lib/colors';
import { num, signed } from './lib/format';

interface Props {
  points: EquityPoint[];
  baseline: string;
  height?: number;
}

/** 权益曲线：纯 SVG，无图表库依赖 */
export function EquityChart({ points, baseline, height = 240 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const W = 900;
  const H = height;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 26;

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => Number(p.equity));
    const base = Number(baseline);
    const min = Math.min(...values, base);
    const max = Math.max(...values, base);
    const span = max - min || 1;
    const lo = min - span * 0.12;
    const hi = max + span * 0.12;

    const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
    const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(Number(p.equity)).toFixed(2)}`).join(' ');
    const area = `${line} L${x(points.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`;

    const yTicks = [lo + (hi - lo) * 0.1, lo + (hi - lo) * 0.5, hi - (hi - lo) * 0.1];
    const step = Math.max(1, Math.floor(points.length / 6));
    const xTicks = points.map((p, i) => ({ i, label: p.date })).filter((_, i) => i % step === 0);

    return { x, y, line, area, lo, hi, yTicks, xTicks, base };
  }, [points, baseline, height]);

  if (!geo) return <div className="empty">数据不足，至少需要 2 笔已平仓交易</div>;

  const last = points[points.length - 1];
  const up = Number(last.equity) >= Number(baseline);
  const color = up ? C.pos : C.neg;
  const gid = up ? 'eqUp' : 'eqDown';

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (rel - padL) / (W - padL - padR);
    const idx = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="eqUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.pos} stopOpacity="0.18" />
            <stop offset="100%" stopColor={C.pos} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="eqDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.neg} stopOpacity="0.18" />
            <stop offset="100%" stopColor={C.neg} stopOpacity="0" />
          </linearGradient>
        </defs>

        {geo.yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={geo.y(v)} y2={geo.y(v)} stroke={C.border} strokeWidth="1" strokeDasharray="2 4" />
            <text x={padL - 8} y={geo.y(v)} fill={C.t3} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily="var(--mono)">
              {num(v, 2)}
            </text>
          </g>
        ))}

        <line
          x1={padL}
          x2={W - padR}
          y1={geo.y(geo.base)}
          y2={geo.y(geo.base)}
          stroke={C.t3}
          strokeWidth="1"
          strokeDasharray="5 4"
          opacity="0.55"
        />
        <text x={W - padR} y={geo.y(geo.base) - 5} fill={C.t3} fontSize="9.5" textAnchor="end">
          初始 {num(geo.base, 2)}
        </text>

        <path d={geo.area} fill={`url(#${gid})`} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />

        {geo.xTicks.map((t) => (
          <text key={t.i} x={geo.x(t.i)} y={H - 8} fill={C.t3} fontSize="10" textAnchor="middle">
            {t.label.slice(5)}
          </text>
        ))}

        {hp && (
          <g>
            <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={padT} y2={H - padB} stroke={C.borderStrong} strokeWidth="1" />
            <circle cx={geo.x(hover!)} cy={geo.y(Number(hp.equity))} r="3.5" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
          </g>
        )}

        <circle cx={geo.x(points.length - 1)} cy={geo.y(Number(last.equity))} r="3" fill={color} />
      </svg>

      {hp && (
        <div
          style={{
            position: 'absolute',
            left: `calc(${(geo.x(hover!) / W) * 100}% + 8px)`,
            top: 8,
            transform: geo.x(hover!) > W * 0.72 ? 'translateX(-108%)' : undefined,
            background: 'var(--surface-3)',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            padding: '6px 9px',
            fontSize: 11,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--mono)',
          }}
        >
          <div style={{ color: C.t3, marginBottom: 2 }}>{hp.date}</div>
          <div>权益 {num(hp.equity, 2)}</div>
          <div className={Number(hp.netPnl) >= 0 ? 'pos' : 'neg'}>本笔 {signed(hp.netPnl, 3)}</div>
          <div style={{ color: C.t3 }}>回撤 {hp.drawdownPct}%</div>
        </div>
      )}
    </div>
  );
}

/** 回撤柱状图 */
export function DrawdownChart({ points, height = 90 }: { points: EquityPoint[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 900;
  const padL = 52;
  const padR = 16;
  const dds = points.map((p) => Number(p.drawdownPct));
  const min = Math.min(...dds, -1);
  const bw = (W - padL - padR) / points.length;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}>
      <line x1={padL} x2={W - padR} y1={8} y2={8} stroke={C.border} strokeWidth="1" />
      <text x={padL - 8} y={8} fill={C.t3} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily="var(--mono)">
        0%
      </text>
      <text x={padL - 8} y={height - 6} fill={C.t3} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily="var(--mono)">
        {min.toFixed(1)}%
      </text>
      {points.map((p, i) => {
        const h = (Math.abs(Number(p.drawdownPct)) / Math.abs(min)) * (height - 22);
        return (
          <rect
            key={i}
            x={padL + i * bw + bw * 0.2}
            y={8}
            width={Math.max(1.5, bw * 0.6)}
            height={h}
            fill={C.neg}
            opacity={Number(p.drawdownPct) === 0 ? 0.1 : 0.32}
            rx="1"
          />
        );
      })}
    </svg>
  );
}

/** 每日盈亏柱 */
export function DailyBars({ data, height = 120 }: { data: { date: string; netPnl: string }[]; height?: number }) {
  if (!data.length) return <div className="empty">暂无数据</div>;
  const W = 900;
  const padL = 52;
  const padR = 16;
  const maxAbs = Math.max(...data.map((d) => Math.abs(Number(d.netPnl))), 0.01);
  const bw = (W - padL - padR) / data.length;
  const mid = height / 2;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}>
      <line x1={padL} x2={W - padR} y1={mid} y2={mid} stroke={C.border} strokeWidth="1" />
      <text x={padL - 8} y={mid - (height / 2 - 14)} fill={C.t3} fontSize="10" textAnchor="end" fontFamily="var(--mono)">
        +{maxAbs.toFixed(2)}
      </text>
      <text x={padL - 8} y={mid + (height / 2 - 14)} fill={C.t3} fontSize="10" textAnchor="end" fontFamily="var(--mono)">
        -{maxAbs.toFixed(2)}
      </text>
      {data.map((d, i) => {
        const v = Number(d.netPnl);
        const h = (Math.abs(v) / maxAbs) * (height / 2 - 12);
        return (
          <rect
            key={i}
            x={padL + i * bw + bw * 0.22}
            y={v >= 0 ? mid - h : mid}
            width={Math.max(2, bw * 0.56)}
            height={Math.max(1.5, h)}
            fill={v >= 0 ? C.pos : C.neg}
            opacity="0.55"
            rx="1.5"
          />
        );
      })}
    </svg>
  );
}
