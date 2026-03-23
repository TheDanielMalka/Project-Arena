import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const data = [
  { month: "JAN", earnings: 320 },
  { month: "FEB", earnings: 480 },
  { month: "MAR", earnings: 290 },
  { month: "APR", earnings: 610 },
  { month: "MAY", earnings: 520 },
  { month: "JUN", earnings: 627 },
];

const W = 560;
const H = 160;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const MIN = 0;
const MAX = 800;

function toX(i: number) {
  return PAD.left + (i / (data.length - 1)) * INNER_W;
}
function toY(v: number) {
  return PAD.top + INNER_H - ((v - MIN) / (MAX - MIN)) * INNER_H;
}

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

const points = data.map((d, i) => ({ x: toX(i), y: toY(d.earnings) }));
const linePath = smoothPath(points);
const areaPath =
  linePath +
  ` L ${points[points.length - 1].x} ${PAD.top + INNER_H}` +
  ` L ${points[0].x} ${PAD.top + INNER_H} Z`;

const GRID_LINES = [0, 200, 400, 600, 800];

export function EarningsChart() {
  const lineRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (lineRef.current && typeof lineRef.current.getTotalLength === "function") {
      const l = lineRef.current.getTotalLength();
      setLength(l);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setDrawn(true));
      });
    } else {
      setDrawn(true);
    }
  }, []);

  const total = data.reduce((s, d) => s + d.earnings, 0);
  const peak = Math.max(...data.map((d) => d.earnings));

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-1">
        <div className="flex justify-between items-start">
          <CardTitle className="font-display text-lg tracking-widest uppercase text-muted-foreground">
            Earnings History
          </CardTitle>
          <div className="text-right">
            <div className="font-display text-2xl font-bold text-foreground leading-none">
              ${total.toLocaleString()}
            </div>
            <div className="font-display text-[10px] tracking-widest text-muted-foreground uppercase mt-0.5">
              Total
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2 pb-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 160 }}
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
          {GRID_LINES.map((v) => {
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
                  x={PAD.left - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={9}
                  fill="hsl(0 0% 40%)"
                  fontFamily="Rajdhani, sans-serif"
                  letterSpacing="0.05em"
                >
                  {v === 0 ? "" : v}
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
            strokeWidth={2}
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
                  r={7}
                  fill="none"
                  stroke="hsl(355 78% 52% / 0.3)"
                  strokeWidth={1.5}
                />
              )}
              {/* Dot */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={hovered === i ? 4 : 3}
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
                    x={pt.x - 28}
                    y={pt.y - 36}
                    width={56}
                    height={22}
                    rx={4}
                    fill="hsl(0 0% 10%)"
                    stroke="hsl(355 78% 52% / 0.25)"
                    strokeWidth={1}
                  />
                  <text
                    x={pt.x}
                    y={pt.y - 20}
                    textAnchor="middle"
                    fontSize={11}
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
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
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
        <div className="flex justify-between mt-2 px-1">
          <div>
            <div className="font-display text-[10px] tracking-widest text-muted-foreground uppercase">Peak</div>
            <div className="font-display text-base font-bold text-foreground">${peak}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-[10px] tracking-widest text-muted-foreground uppercase">Avg / Month</div>
            <div className="font-display text-base font-bold text-foreground">
              ${Math.round(total / data.length)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
