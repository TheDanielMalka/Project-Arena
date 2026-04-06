import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import type { Match } from "@/types";

const W = 560;
const H = 96;
const PAD = { top: 10, right: 12, bottom: 18, left: 34 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

// Smooth curve via cubic bezier
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cp1x = pts[i].x + (pts[i + 1].x - pts[i].x) / 2;
    const cp1y = pts[i].y;
    const cp2x = pts[i].x + (pts[i + 1].x - pts[i].x) / 2;
    const cp2y = pts[i + 1].y;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

export function EarningsChart() {
  const user = useUserStore((s) => s.user);
  const matches = useMatchStore((s) => s.matches);
  const myId = user?.id ?? "";

  const data = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; earnings: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
      months.push({ key, label, earnings: 0 });
    }
    const idx = new Map(months.map((m, i) => [m.key, i] as const));

    const completed = matches.filter((m: Match) => m.status === "completed" && !!m.winnerId);
    for (const m of completed) {
      if (!myId) continue;
      if (m.winnerId !== myId) continue;
      const iso = m.endedAt ?? m.createdAt;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const i = idx.get(key);
      if (i === undefined) continue;
      months[i]!.earnings += m.betAmount ?? 0;
    }
    return months.map((m) => ({ month: m.label, earnings: Math.round(m.earnings) }));
  }, [matches, myId]);

  const min = 0;
  const peak = Math.max(0, ...data.map((d) => d.earnings));
  const max = Math.max(100, Math.ceil(peak / 100) * 100);
  const gridLines = max <= 200 ? [0, max / 2, max] : [0, max * 0.25, max * 0.5, max * 0.75, max];

  const toX = (i: number) => PAD.left + (i / Math.max(1, data.length - 1)) * INNER_W;
  const toY = (v: number) =>
    PAD.top + INNER_H - ((v - min) / Math.max(1, max - min)) * INNER_H;

  const points = data.map((d, i) => ({ x: toX(i), y: toY(d.earnings) }));
  const linePath = smoothPath(points);
  const areaPath =
    linePath +
    ` L ${points[points.length - 1]!.x} ${PAD.top + INNER_H}` +
    ` L ${points[0]!.x} ${PAD.top + INNER_H} Z`;

  const lineRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (lineRef.current && typeof lineRef.current.getTotalLength === "function") {
      const l = lineRef.current.getTotalLength();
      setLength(l);
      setDrawn(true);
    } else {
      setDrawn(true);
    }
  }, [linePath]);

  const total = data.reduce((s, d) => s + d.earnings, 0);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-0 pt-3 px-3">
        <div className="flex justify-between items-start gap-2">
          <CardTitle className="font-display text-xs tracking-widest uppercase text-muted-foreground">
            Earnings History
          </CardTitle>
          <div className="text-right shrink-0">
            <div className="font-display text-lg font-bold text-foreground leading-none">
              ${total.toLocaleString()}
            </div>
            <div className="font-display text-[9px] tracking-widest text-muted-foreground uppercase mt-0.5">
              Total
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-1 pb-2 px-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 96 }}
        >
          <defs>
            {/* Red gradient fill */}
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(355 78% 52%)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="hsl(355 78% 52%)" stopOpacity={0} />
            </linearGradient>

            {/* Glow filter for the line */}
            <filter id="lineGlow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Clip for draw animation */}
            <clipPath id="drawClip">
              <rect x="0" y="0" width={W} height={H} />
            </clipPath>
          </defs>

          {/* Grid lines */}
          {gridLines.map((v) => {
            const y = toY(v);
            return (
              <g key={v}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={W - PAD.right}
                  y2={y}
                  stroke="hsl(0 0% 100% / 0.04)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 4}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={8}
                  fill="hsl(0 0% 40%)"
                  fontFamily="Rajdhani, sans-serif"
                  letterSpacing="0.05em"
                >
                  {v === 0 ? "" : Math.round(v)}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path
            d={areaPath}
            fill="url(#areaGrad)"
            style={{
              opacity: drawn ? 1 : 0,
              transition: "opacity 0.6s ease 0.8s",
            }}
          />

          {/* Hover vertical line */}
          {hovered !== null && (
            <line
              x1={points[hovered].x}
              y1={PAD.top}
              x2={points[hovered].x}
              y2={PAD.top + INNER_H}
              stroke="hsl(355 78% 52% / 0.2)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}

          {/* Main line with draw animation */}
          <path
            ref={lineRef}
            d={linePath}
            fill="none"
            stroke="hsl(355 78% 52%)"
            strokeWidth={1.5}
            filter="url(#lineGlow)"
            strokeDasharray={length || 9999}
            strokeDashoffset={drawn ? 0 : length || 9999}
            style={{
              transition: length
                ? "stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.1s"
                : "none",
            }}
          />

          {/* Data points */}
          {points.map((pt, i) => (
            <g key={i}>
              {/* Hit area */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={16}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "crosshair" }}
              />
              {/* Outer ring on hover */}
              {hovered === i && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  fill="none"
                  stroke="hsl(355 78% 52% / 0.3)"
                  strokeWidth={1.5}
                />
              )}
              {/* Dot */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={hovered === i ? 3.5 : 2.5}
                fill={hovered === i ? "hsl(355 78% 65%)" : "hsl(355 78% 52%)"}
                stroke="hsl(0 0% 8%)"
                strokeWidth={2}
                style={{
                  opacity: drawn ? 1 : 0,
                  transition: `opacity 0.3s ease ${0.8 + i * 0.08}s, r 0.15s ease, fill 0.15s ease`,
                  filter: hovered === i ? "drop-shadow(0 0 6px hsl(355 78% 52% / 0.8))" : "none",
                }}
              />
              {/* Tooltip */}
              {hovered === i && (
                <g>
                  <rect
                    x={pt.x - 24}
                    y={pt.y - 28}
                    width={48}
                    height={18}
                    rx={3}
                    fill="hsl(0 0% 10%)"
                    stroke="hsl(355 78% 52% / 0.25)"
                    strokeWidth={1}
                  />
                  <text
                    x={pt.x}
                    y={pt.y - 15}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight="bold"
                    fill="hsl(0 0% 95%)"
                    fontFamily="Rajdhani, sans-serif"
                    letterSpacing="0.05em"
                  >
                    ${data[i].earnings}
                  </text>
                </g>
              )}
            </g>
          ))}

          {/* X axis labels */}
          {data.map((d, i) => (
            <text
              key={i}
              x={toX(i)}
              y={H - 2}
              textAnchor="middle"
              fontSize={8}
              fill={hovered === i ? "hsl(355 78% 65%)" : "hsl(0 0% 40%)"}
              fontFamily="Rajdhani, sans-serif"
              letterSpacing="0.12em"
              style={{ transition: "fill 0.15s" }}
            >
              {d.month}
            </text>
          ))}
        </svg>

        {/* Bottom stats */}
        <div className="flex justify-between mt-1 px-0.5">
          <div>
            <div className="font-display text-[9px] tracking-widest text-muted-foreground uppercase">Peak</div>
            <div className="font-display text-sm font-bold text-foreground">${peak}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-[9px] tracking-widest text-muted-foreground uppercase">Avg / Month</div>
            <div className="font-display text-sm font-bold text-foreground">
              ${Math.round(total / data.length)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
