import type { PublicTrade } from "../api";

interface PriceChartProps {
  symbol: string;
  trades: PublicTrade[];
  midPrice: number | null;
}

export function PriceChart({ symbol, trades, midPrice }: PriceChartProps) {
  // Reverse so oldest is on the left, newest on the right
  const chronological = [...trades].reverse();
  const points = chronological.map((t) => t.price);

  if (points.length === 0 && midPrice !== null) {
    points.push(midPrice, midPrice);
  } else if (points.length === 1) {
    points.push(points[0]!);
  }

  const width = 800;
  const height = 280;
  const padX = 16;
  const padY = 24;

  const min = points.length ? Math.min(...points) : 0;
  const max = points.length ? Math.max(...points) : 0;
  const span = max - min || Math.max(max * 0.02, 1);
  const low = min - span * 0.15;
  const high = max + span * 0.15;

  const isUp = points.length >= 2 ? points[points.length - 1]! >= points[0]! : true;
  const stroke = isUp ? "#00c278" : "#fd4b4e";

  const coords = points.map((p, i) => {
    const x = padX + (i / Math.max(points.length - 1, 1)) * (width - padX * 2);
    const y = padY + (1 - (p - low) / (high - low)) * (height - padY * 2);
    return { x, y, price: p };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1]!.x.toFixed(1)},${height - padY} L${coords[0]!.x.toFixed(1)},${height - padY} Z`
      : "";

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padY + t * (height - padY * 2);
    const price = high - t * (high - low);
    return { y, price };
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-[#202127] flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[#f4f4f6]">{symbol}/USD Price</span>
          <span className="text-[#969faf]">Last {trades.length} fills</span>
        </div>
        {points.length > 0 && (
          <div className="flex items-center gap-4 font-mono text-[11px] text-[#969faf]">
            <span>
              H <span className="text-[#f4f4f6]">${max.toFixed(2)}</span>
            </span>
            <span>
              L <span className="text-[#f4f4f6]">${min.toFixed(2)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[260px] flex items-center justify-center p-2 relative">
        {coords.length === 0 ? (
          <div className="text-center">
            <p className="text-sm text-[#969faf]">No trades or quotes yet for {symbol}/USD</p>
            <p className="text-xs text-[#646b7a] mt-1">
              Place a limit order on the right to seed the orderbook
            </p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
            <defs>
              <linearGradient id="bpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {gridLines.map((g, idx) => (
              <g key={idx}>
                <line
                  x1={padX}
                  x2={width - 68}
                  y1={g.y}
                  y2={g.y}
                  stroke="#202127"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={width - 62}
                  y={g.y + 4}
                  fill="#757d8c"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  ${g.price.toFixed(2)}
                </text>
              </g>
            ))}

            <path d={areaPath} fill="url(#bpAreaGrad)" />
            <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />

            {coords.length > 0 && (
              <circle
                cx={coords[coords.length - 1]!.x}
                cy={coords[coords.length - 1]!.y}
                r="4"
                fill={stroke}
              />
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
