import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api, type Depth, type Market, type PublicTrade } from "../api";

interface MarketRow extends Market {
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  tradeCount: number;
}

export function MarketsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { markets } = await api.getMarkets();
        const enriched = await Promise.all(
          markets.map(async (m) => {
            const [depth, tradesRes] = await Promise.all([
              api.getDepth(m.symbol).catch((): Depth => ({ market: m.symbol, bids: [], asks: [] })),
              api.getTrades(m.symbol).catch((): { market: string; trades: PublicTrade[] } => ({
                market: m.symbol,
                trades: [],
              })),
            ]);
            const bestBid = depth.bids[0]?.[0] ?? null;
            const bestAsk = depth.asks[0]?.[0] ?? null;
            const lastPrice =
              tradesRes.trades[0]?.price ??
              (bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk);
            const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

            return {
              ...m,
              lastPrice,
              bestBid,
              bestAsk,
              spread,
              tradeCount: tradesRes.trades.length,
            };
          })
        );
        if (!cancelled) setRows(enriched);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const fmt = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#f4f4f6]">Spot Markets</h1>
          <p className="text-sm text-[#969faf] mt-1">
            Real-time orderbook matching powered by an in-memory engine
          </p>
        </div>
        <button
          onClick={() => navigate("/trade/SOL")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f4f4f6] hover:bg-white text-[#0e0f14] text-xs font-semibold transition-colors cursor-pointer self-start"
        >
          Launch Terminal <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="rounded-xl bg-[#14151b] border border-[#202127] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#202127] text-[11px] uppercase tracking-wider text-[#969faf]">
              <th className="py-3.5 px-5 font-medium">Market</th>
              <th className="py-3.5 px-5 font-medium text-right">Last / Mid Price</th>
              <th className="py-3.5 px-5 font-medium text-right">Best Bid</th>
              <th className="py-3.5 px-5 font-medium text-right">Best Ask</th>
              <th className="py-3.5 px-5 font-medium text-right">Spread</th>
              <th className="py-3.5 px-5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#202127]/60 text-sm">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[#969faf]">
                  Loading markets...
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/trade/${m.symbol}`)}
                  className="hover:bg-[#1a1c24] transition-colors cursor-pointer"
                >
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#202127] flex items-center justify-center text-xs font-bold text-[#f4f4f6]">
                        {m.symbol.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-semibold text-[#f4f4f6]">
                          {m.symbol}
                          <span className="text-[#969faf] font-normal">/USD</span>
                        </div>
                        <div className="text-xs text-[#969faf]">{m.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-5 text-right font-mono font-medium text-[#f4f4f6]">
                    {fmt(m.lastPrice)}
                  </td>
                  <td className="py-4 px-5 text-right font-mono text-[#00c278]">{fmt(m.bestBid)}</td>
                  <td className="py-4 px-5 text-right font-mono text-[#fd4b4e]">{fmt(m.bestAsk)}</td>
                  <td className="py-4 px-5 text-right font-mono text-[#969faf]">{fmt(m.spread)}</td>
                  <td className="py-4 px-5 text-right">
                    <span className="inline-block px-3 py-1.5 rounded-lg bg-[#202127] hover:bg-[#2c2e38] text-xs font-semibold text-[#f4f4f6]">
                      Trade
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
