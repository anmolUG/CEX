import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
import {
  api,
  type Depth,
  type FillRecord,
  type Market,
  type OrderRecord,
  type PublicTrade,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { PriceChart } from "../components/PriceChart";

interface TradePageProps {
  onOpenDeposit: () => void;
}

type BottomTab = "open" | "balances" | "orders" | "fills";

export function TradePage({ onOpenDeposit }: TradePageProps) {
  const { symbol: rawSymbol } = useParams();
  const symbol = (rawSymbol ?? "SOL").toUpperCase();
  const navigate = useNavigate();
  const { user, balances, refreshBalances } = useAuth();

  // Market data
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);
  const [depth, setDepth] = useState<Depth>({ market: symbol, bids: [], asks: [] });
  const [trades, setTrades] = useState<PublicTrade[]>([]);
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");

  // User tables
  const [bottomTab, setBottomTab] = useState<BottomTab>("open");
  const [openOrders, setOpenOrders] = useState<OrderRecord[]>([]);
  const [allOrders, setAllOrders] = useState<OrderRecord[]>([]);
  const [fills, setFills] = useState<FillRecord[]>([]);

  // Order ticket
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadMarketData = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([
        api.getDepth(symbol),
        api.getTrades(symbol).catch(() => ({ market: symbol, trades: [] })),
      ]);
      setDepth(d);
      setTrades(t.trades);
    } catch {
      // ignore transient polling error
    }
  }, [symbol]);

  const loadUserData = useCallback(async () => {
    if (!user?.token) {
      setOpenOrders([]);
      setAllOrders([]);
      setFills([]);
      return;
    }
    try {
      const [openRes, allRes, fillsRes] = await Promise.all([
        api.getOpenOrders(user.token),
        api.getOrders(user.token),
        api.getFills(user.token),
      ]);
      setOpenOrders(openRes.orders);
      setAllOrders(allRes.orders);
      setFills(fillsRes.fills);
      await refreshBalances();
    } catch {
      // ignore transient polling error
    }
  }, [user?.token, refreshBalances]);

  useEffect(() => {
    void api.getMarkets().then((res) => setMarkets(res.markets)).catch(() => {});
  }, []);

  useEffect(() => {
    void loadMarketData();
    const id = setInterval(loadMarketData, 1500);
    return () => clearInterval(id);
  }, [loadMarketData]);

  useEffect(() => {
    void loadUserData();
    const id = setInterval(loadUserData, 3000);
    return () => clearInterval(id);
  }, [loadUserData]);

  const bestBid = depth.bids[0]?.[0] ?? null;
  const bestAsk = depth.asks[0]?.[0] ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const midPrice =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
  const lastPrice = trades[0]?.price ?? midPrice;

  const usdAvailable = balances.USD?.available ?? 0;
  const baseAvailable = balances[symbol]?.available ?? 0;

  const numericPrice = orderType === "limit" ? Number(price) || 0 : lastPrice ?? 0;
  const numericQty = Number(qty) || 0;
  const orderTotal = numericPrice * numericQty;

  const applyPercent = (pct: number) => {
    if (side === "sell") {
      const next = Math.floor(baseAvailable * pct * 10000) / 10000;
      setQty(next > 0 ? String(next) : "");
    } else if (numericPrice > 0) {
      const maxQty = (usdAvailable * pct) / numericPrice;
      const next = Math.floor(maxQty * 10000) / 10000;
      setQty(next > 0 ? String(next) : "");
    }
  };

  const handlePlaceOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.token) {
      navigate("/signin");
      return;
    }
    setFeedback(null);
    setSubmitting(true);

    try {
      const res = await api.placeOrder(user.token, {
        type: orderType,
        side,
        market_id: symbol,
        price: orderType === "limit" ? Number(price) : null,
        qty: Number(qty),
      });
      setFeedback({
        kind: "ok",
        text:
          res.filledQty > 0
            ? `${res.status} — filled ${res.filledQty} ${symbol} @ $${res.averagePrice?.toFixed(2)}`
            : `Order placed (${res.status})`,
      });
      setQty("");
      await Promise.all([loadMarketData(), loadUserData()]);
    } catch (err) {
      setFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : "Order failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (orderId: string) => {
    if (!user?.token) return;
    try {
      await api.cancelOrder(user.token, orderId);
      await Promise.all([loadMarketData(), loadUserData()]);
    } catch (err) {
      setFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : "Cancel failed",
      });
    }
  };

  // Show top 12 asks (highest at top, lowest near spread) and top 12 bids
  const visibleAsks = [...depth.asks.slice(0, 12)].reverse();
  const visibleBids = depth.bids.slice(0, 12);
  const maxAskQty = Math.max(...visibleAsks.map(([, q]) => q), 1);
  const maxBidQty = Math.max(...visibleBids.map(([, q]) => q), 1);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0e0f14] p-2 flex flex-col gap-2">
      {/* Top Ticker Bar */}
      <div className="rounded-xl bg-[#14151b] border border-[#202127] px-4 py-2.5 flex flex-wrap items-center gap-6">
        <div className="relative">
          <button
            onClick={() => setMarketMenuOpen((v) => !v)}
            className="flex items-center gap-2 text-left cursor-pointer hover:bg-[#202127] px-2.5 py-1.5 -ml-2 rounded-lg transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-[#202127] flex items-center justify-center text-xs font-bold text-[#f4f4f6]">
              {symbol.slice(0, 1)}
            </div>
            <span className="font-semibold text-sm text-[#f4f4f6]">
              {symbol}
              <span className="text-[#969faf] font-normal">/USD</span>
            </span>
            <ChevronDown className="w-4 h-4 text-[#969faf]" />
          </button>

          {marketMenuOpen && (
            <div className="absolute left-0 mt-1.5 w-44 rounded-xl bg-[#14151b] border border-[#202127] shadow-2xl py-1 z-20">
              {(markets.length ? markets : [{ id: "1", symbol: "SOL", name: "Solana" }, { id: "2", symbol: "BTC", name: "Bitcoin" }]).map(
                (m) => (
                  <button
                    key={m.symbol}
                    onClick={() => {
                      setMarketMenuOpen(false);
                      navigate(`/trade/${m.symbol}`);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#202127] cursor-pointer ${
                      m.symbol === symbol ? "text-[#f4f4f6] font-semibold" : "text-[#969faf]"
                    }`}
                  >
                    <span>{m.symbol}/USD</span>
                    <span className="text-[11px] text-[#646b7a]">{m.name}</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 text-xs">
          <div>
            <div className="text-[11px] text-[#969faf]">Last Price</div>
            <div className="font-mono font-semibold text-sm text-[#00c278]">
              {lastPrice !== null ? `$${lastPrice.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#969faf]">Best Bid</div>
            <div className="font-mono font-medium text-[#f4f4f6]">
              {bestBid !== null ? `$${bestBid.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#969faf]">Best Ask</div>
            <div className="font-mono font-medium text-[#f4f4f6]">
              {bestAsk !== null ? `$${bestAsk.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#969faf]">Spread</div>
            <div className="font-mono font-medium text-[#969faf]">
              {spread !== null ? `$${spread.toFixed(2)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Main 3-Column Backpack Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 flex-1">
        {/* Left/Center: Chart + Bottom User Tabs */}
        <div className="lg:col-span-6 xl:col-span-7 flex flex-col gap-2">
          <div className="rounded-xl bg-[#14151b] border border-[#202127] h-[340px]">
            <PriceChart symbol={symbol} trades={trades} midPrice={midPrice} />
          </div>

          {/* Bottom User Panel */}
          <div className="rounded-xl bg-[#14151b] border border-[#202127] flex-1 min-h-[260px] flex flex-col overflow-hidden">
            <div className="flex items-center gap-1 px-3 pt-2.5 border-b border-[#202127]">
              {(
                [
                  ["open", `Open Orders (${openOrders.length})`],
                  ["balances", "Balances"],
                  ["orders", "Order History"],
                  ["fills", "Fill History"],
                ] as [BottomTab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setBottomTab(key)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                    bottomTab === key
                      ? "border-[#4c94ff] text-[#f4f4f6]"
                      : "border-transparent text-[#969faf] hover:text-[#f4f4f6]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto">
              {!user ? (
                <div className="h-full flex flex-col items-center justify-center py-10 text-xs text-[#969faf] gap-3">
                  <span>Sign in to view your orders, balances, and fills</span>
                  <Link
                    to="/signin"
                    className="px-3.5 py-1.5 rounded-lg bg-[#202127] hover:bg-[#2c2e38] text-[#f4f4f6] font-semibold"
                  >
                    Sign in
                  </Link>
                </div>
              ) : bottomTab === "open" ? (
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-[#969faf] border-b border-[#202127]">
                    <tr>
                      <th className="py-2 px-4 font-medium">Market</th>
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-3 font-medium text-right">Price</th>
                      <th className="py-2 px-3 font-medium text-right">Filled / Qty</th>
                      <th className="py-2 px-3 font-medium text-right">Status</th>
                      <th className="py-2 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202127]/60 font-mono">
                    {openOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center font-sans text-[#646b7a]">
                          No open orders
                        </td>
                      </tr>
                    ) : (
                      openOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-[#1a1c24]">
                          <td className="py-2.5 px-4 font-sans font-medium text-[#f4f4f6]">
                            {o.stock.symbol}/USD
                          </td>
                          <td
                            className={`py-2.5 px-3 font-semibold ${
                              o.side === "BUY" ? "text-[#00c278]" : "text-[#fd4b4e]"
                            }`}
                          >
                            {o.side}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            ${o.price ? Number(o.price).toFixed(2) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {Number(o.filledQty)} / {Number(o.qty)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#969faf]">{o.status}</td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={() => handleCancel(o.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#fd4b4e]/15 text-[#fd4b4e] hover:bg-[#fd4b4e]/25 font-sans font-medium cursor-pointer"
                            >
                              <X className="w-3 h-3" /> Cancel
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : bottomTab === "balances" ? (
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-[#969faf] border-b border-[#202127]">
                    <tr>
                      <th className="py-2 px-4 font-medium">Asset</th>
                      <th className="py-2 px-4 font-medium text-right">Available</th>
                      <th className="py-2 px-4 font-medium text-right">Locked</th>
                      <th className="py-2 px-4 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202127]/60 font-mono">
                    {Object.entries(balances).map(([asset, h]) => (
                      <tr key={asset} className="hover:bg-[#1a1c24]">
                        <td className="py-2.5 px-4 font-sans font-semibold text-[#f4f4f6]">{asset}</td>
                        <td className="py-2.5 px-4 text-right">{h.available.toLocaleString()}</td>
                        <td className="py-2.5 px-4 text-right text-[#969faf]">{h.locked.toLocaleString()}</td>
                        <td className="py-2.5 px-4 text-right font-semibold">
                          {(h.available + h.locked).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : bottomTab === "orders" ? (
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-[#969faf] border-b border-[#202127]">
                    <tr>
                      <th className="py-2 px-4 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Market</th>
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-3 font-medium text-right">Price</th>
                      <th className="py-2 px-3 font-medium text-right">Filled / Qty</th>
                      <th className="py-2 px-4 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202127]/60 font-mono">
                    {allOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#1a1c24]">
                        <td className="py-2.5 px-4 text-[#969faf]">
                          {new Date(o.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[#f4f4f6]">{o.stock.symbol}/USD</td>
                        <td
                          className={`py-2.5 px-3 font-semibold ${
                            o.side === "BUY" ? "text-[#00c278]" : "text-[#fd4b4e]"
                          }`}
                        >
                          {o.side}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {o.price ? `$${Number(o.price).toFixed(2)}` : "Market"}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {Number(o.filledQty)} / {Number(o.qty)}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[#969faf]">{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-[#969faf] border-b border-[#202127]">
                    <tr>
                      <th className="py-2 px-4 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Market</th>
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-3 font-medium text-right">Price</th>
                      <th className="py-2 px-4 font-medium text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202127]/60 font-mono">
                    {fills.map((f) => (
                      <tr key={f.id} className="hover:bg-[#1a1c24]">
                        <td className="py-2.5 px-4 text-[#969faf]">
                          {new Date(f.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[#f4f4f6]">{f.stock.symbol}/USD</td>
                        <td
                          className={`py-2.5 px-3 font-semibold ${
                            f.side === "BUY" ? "text-[#00c278]" : "text-[#fd4b4e]"
                          }`}
                        >
                          {f.side}
                        </td>
                        <td className="py-2.5 px-3 text-right">${Number(f.price).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">{Number(f.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Middle-Right: Orderbook / Trades */}
        <div className="lg:col-span-3 xl:col-span-2 rounded-xl bg-[#14151b] border border-[#202127] flex flex-col overflow-hidden min-h-[520px]">
          <div className="flex border-b border-[#202127] px-2 pt-2">
            {(
              [
                ["book", "Book"],
                ["trades", "Trades"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setBookTab(tab)}
                className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                  bookTab === tab
                    ? "border-[#4c94ff] text-[#f4f4f6]"
                    : "border-transparent text-[#969faf] hover:text-[#f4f4f6]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {bookTab === "book" ? (
            <div className="flex-1 flex flex-col text-xs font-mono">
              <div className="grid grid-cols-2 px-3 py-2 text-[11px] font-sans text-[#969faf]">
                <span>Price (USD)</span>
                <span className="text-right">Size ({symbol})</span>
              </div>

              {/* Asks */}
              <div className="flex-1 flex flex-col justify-end overflow-hidden">
                {visibleAsks.length === 0 ? (
                  <div className="py-6 text-center font-sans text-[11px] text-[#646b7a]">No asks</div>
                ) : (
                  visibleAsks.map(([p, q]) => (
                    <button
                      key={`ask-${p}`}
                      type="button"
                      onClick={() => {
                        setOrderType("limit");
                        setPrice(String(p));
                      }}
                      className="relative w-full grid grid-cols-2 px-3 py-1 hover:bg-[#202127]/70 text-left cursor-pointer"
                    >
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-[#fd4b4e]/15 pointer-events-none"
                        style={{ width: `${Math.min((q / maxAskQty) * 100, 100)}%` }}
                      />
                      <span className="relative text-[#fd4b4e]">{p.toFixed(2)}</span>
                      <span className="relative text-right text-[#f4f4f6]">{q.toFixed(4)}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Mid / Spread */}
              <div className="my-1.5 px-3 py-2 border-y border-[#202127] flex items-center justify-between">
                <span className="text-sm font-semibold text-[#00c278]">
                  {lastPrice !== null ? `$${lastPrice.toFixed(2)}` : "—"}
                </span>
                <span className="text-[11px] font-sans text-[#969faf]">
                  {spread !== null ? `Spread $${spread.toFixed(2)}` : "No spread"}
                </span>
              </div>

              {/* Bids */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {visibleBids.length === 0 ? (
                  <div className="py-6 text-center font-sans text-[11px] text-[#646b7a]">No bids</div>
                ) : (
                  visibleBids.map(([p, q]) => (
                    <button
                      key={`bid-${p}`}
                      type="button"
                      onClick={() => {
                        setOrderType("limit");
                        setPrice(String(p));
                      }}
                      className="relative w-full grid grid-cols-2 px-3 py-1 hover:bg-[#202127]/70 text-left cursor-pointer"
                    >
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-[#00c278]/15 pointer-events-none"
                        style={{ width: `${Math.min((q / maxBidQty) * 100, 100)}%` }}
                      />
                      <span className="relative text-[#00c278]">{p.toFixed(2)}</span>
                      <span className="relative text-right text-[#f4f4f6]">{q.toFixed(4)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto text-xs font-mono">
              <div className="grid grid-cols-3 px-3 py-2 text-[11px] font-sans text-[#969faf]">
                <span>Price</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Time</span>
              </div>
              {trades.length === 0 ? (
                <div className="py-10 text-center font-sans text-[11px] text-[#646b7a]">
                  No recent trades
                </div>
              ) : (
                trades.map((t) => (
                  <div key={t.id} className="grid grid-cols-3 px-3 py-1 hover:bg-[#1a1c24]">
                    <span className="text-[#00c278]">{t.price.toFixed(2)}</span>
                    <span className="text-right text-[#f4f4f6]">{t.qty.toFixed(4)}</span>
                    <span className="text-right text-[#969faf]">
                      {new Date(t.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right: Order Ticket */}
        <div className="lg:col-span-3 xl:col-span-3 rounded-xl bg-[#14151b] border border-[#202127] p-4 flex flex-col">
          {/* Buy / Sell Toggle */}
          <div className="grid grid-cols-2 rounded-xl bg-[#0e0f14] p-1 mb-4 border border-[#202127]">
            <button
              type="button"
              onClick={() => setSide("buy")}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                side === "buy"
                  ? "bg-[#00c278]/20 text-[#00c278]"
                  : "text-[#969faf] hover:text-[#f4f4f6]"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setSide("sell")}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                side === "sell"
                  ? "bg-[#fd4b4e]/20 text-[#fd4b4e]"
                  : "text-[#969faf] hover:text-[#f4f4f6]"
              }`}
            >
              Sell
            </button>
          </div>

          {/* Limit / Market Tabs */}
          <div className="flex items-center gap-4 border-b border-[#202127] mb-4">
            {(["limit", "market"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={`pb-2 text-xs font-semibold capitalize border-b-2 transition-colors cursor-pointer ${
                  orderType === t
                    ? "border-[#f4f4f6] text-[#f4f4f6]"
                    : "border-transparent text-[#969faf] hover:text-[#f4f4f6]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <form onSubmit={handlePlaceOrder} className="space-y-3.5 flex-1 flex flex-col">
            {/* Available Balance */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#969faf]">Available</span>
              <span className="font-mono text-[#f4f4f6]">
                {side === "buy"
                  ? `${usdAvailable.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`
                  : `${baseAvailable.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`}
              </span>
            </div>

            {/* Price Input */}
            <div>
              <label className="block text-xs text-[#969faf] mb-1">Price (USD)</label>
              {orderType === "limit" ? (
                <input
                  type="number"
                  step="0.01"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={lastPrice ? lastPrice.toFixed(2) : "0.00"}
                  className="w-full rounded-lg bg-[#0e0f14] border border-[#202127] focus:border-[#4c94ff] outline-none px-3 py-2.5 text-sm font-mono text-[#f4f4f6]"
                />
              ) : (
                <div className="w-full rounded-lg bg-[#0e0f14]/60 border border-[#202127] px-3 py-2.5 text-sm text-[#969faf]">
                  Best Market Price
                </div>
              )}
            </div>

            {/* Qty Input */}
            <div>
              <label className="block text-xs text-[#969faf] mb-1">Quantity ({symbol})</label>
              <input
                type="number"
                step="0.0001"
                required
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0.0000"
                className="w-full rounded-lg bg-[#0e0f14] border border-[#202127] focus:border-[#4c94ff] outline-none px-3 py-2.5 text-sm font-mono text-[#f4f4f6]"
              />
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyPercent(pct)}
                    className="py-1 rounded-md bg-[#0e0f14] border border-[#202127] hover:border-[#343742] text-[11px] font-mono text-[#969faf] hover:text-[#f4f4f6] cursor-pointer"
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            {/* Order Value Preview */}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-[#202127]">
              <span className="text-[#969faf]">Order Value</span>
              <span className="font-mono text-[#f4f4f6]">
                {orderTotal > 0 ? `$${orderTotal.toFixed(2)} USD` : "—"}
              </span>
            </div>

            {feedback && (
              <div
                className={`rounded-lg px-3 py-2 text-xs border ${
                  feedback.kind === "ok"
                    ? "bg-[#00c278]/10 border-[#00c278]/30 text-[#00c278]"
                    : "bg-[#fd4b4e]/10 border-[#fd4b4e]/30 text-[#fd4b4e]"
                }`}
              >
                {feedback.text}
              </div>
            )}

            <div className="pt-1 mt-auto space-y-2">
              {user ? (
                <>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 cursor-pointer ${
                      side === "buy"
                        ? "bg-[#00c278] hover:bg-[#00d484] text-[#0e0f14]"
                        : "bg-[#fd4b4e] hover:bg-[#ff5e61] text-white"
                    }`}
                  >
                    {submitting
                      ? "Submitting..."
                      : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDeposit}
                    className="w-full py-2 rounded-xl bg-[#0e0f14] hover:bg-[#202127] border border-[#202127] text-xs font-medium text-[#969faf] hover:text-[#f4f4f6] transition-colors cursor-pointer"
                  >
                    Deposit Test Funds
                  </button>
                </>
              ) : (
                <Link
                  to="/signin"
                  className="block w-full text-center py-3 rounded-xl bg-[#f4f4f6] hover:bg-white text-[#0e0f14] font-semibold text-sm transition-colors"
                >
                  Sign in to Trade
                </Link>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
