import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine } from "lucide-react";
import { api, type FillRecord, type OrderRecord } from "../api";
import { useAuth } from "../context/AuthContext";

interface PortfolioPageProps {
  onOpenDeposit: () => void;
}

export function PortfolioPage({ onOpenDeposit }: PortfolioPageProps) {
  const { user, balances, refreshBalances } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [fills, setFills] = useState<FillRecord[]>([]);

  useEffect(() => {
    if (!user?.token) return;
    void refreshBalances();
    void Promise.all([api.getOrders(user.token), api.getFills(user.token)]).then(([o, f]) => {
      setOrders(o.orders);
      setFills(f.fills);
    });
  }, [user?.token, refreshBalances]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-[#f4f4f6] mb-2">Sign in to view Portfolio</h1>
        <p className="text-sm text-[#969faf] mb-6">
          Track your balances, open orders, and executed trade fills.
        </p>
        <Link
          to="/signin"
          className="inline-block px-5 py-2.5 rounded-lg bg-[#f4f4f6] text-[#0e0f14] text-sm font-semibold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const assets = Object.entries(balances);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#f4f4f6]">Portfolio</h1>
          <p className="text-sm text-[#969faf] mt-0.5">Account: {user.username}</p>
        </div>
        <button
          onClick={onOpenDeposit}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00c278] hover:bg-[#00d484] text-[#0e0f14] text-xs font-semibold cursor-pointer"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          Deposit Funds
        </button>
      </div>

      {/* Balances */}
      <div className="rounded-xl bg-[#14151b] border border-[#202127] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#202127] text-sm font-semibold text-[#f4f4f6]">
          Balances
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#202127] text-[11px] uppercase tracking-wider text-[#969faf]">
              <th className="py-3 px-5 font-medium">Asset</th>
              <th className="py-3 px-5 font-medium text-right">Available</th>
              <th className="py-3 px-5 font-medium text-right">Locked in Orders</th>
              <th className="py-3 px-5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#202127]/60 text-sm">
            {assets.map(([asset, h]) => (
              <tr key={asset} className="hover:bg-[#1a1c24]">
                <td className="py-3.5 px-5 font-semibold text-[#f4f4f6]">{asset}</td>
                <td className="py-3.5 px-5 text-right font-mono text-[#f4f4f6]">
                  {h.available.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </td>
                <td className="py-3.5 px-5 text-right font-mono text-[#969faf]">
                  {h.locked.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </td>
                <td className="py-3.5 px-5 text-right font-mono font-semibold text-[#f4f4f6]">
                  {(h.available + h.locked).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Fills */}
      <div className="rounded-xl bg-[#14151b] border border-[#202127] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#202127] text-sm font-semibold text-[#f4f4f6]">
          Recent Fills ({fills.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#202127] uppercase tracking-wider text-[#969faf]">
                <th className="py-2.5 px-5 font-medium">Time</th>
                <th className="py-2.5 px-5 font-medium">Market</th>
                <th className="py-2.5 px-5 font-medium">Side</th>
                <th className="py-2.5 px-5 font-medium text-right">Price</th>
                <th className="py-2.5 px-5 font-medium text-right">Qty</th>
                <th className="py-2.5 px-5 font-medium text-right">Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202127]/60 font-mono">
              {fills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center font-sans text-[#969faf]">
                    No executed fills yet
                  </td>
                </tr>
              ) : (
                fills.map((f) => (
                  <tr key={f.id} className="hover:bg-[#1a1c24]">
                    <td className="py-3 px-5 text-[#969faf]">{new Date(f.createdAt).toLocaleString()}</td>
                    <td className="py-3 px-5 font-sans font-medium text-[#f4f4f6]">{f.stock.symbol}/USD</td>
                    <td className={`py-3 px-5 font-semibold ${f.side === "BUY" ? "text-[#00c278]" : "text-[#fd4b4e]"}`}>
                      {f.side}
                    </td>
                    <td className="py-3 px-5 text-right text-[#f4f4f6]">${Number(f.price).toFixed(2)}</td>
                    <td className="py-3 px-5 text-right text-[#f4f4f6]">{Number(f.qty)}</td>
                    <td className="py-3 px-5 text-right text-[#f4f4f6]">
                      ${(Number(f.price) * Number(f.qty)).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order History */}
      <div className="rounded-xl bg-[#14151b] border border-[#202127] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#202127] text-sm font-semibold text-[#f4f4f6]">
          Order History ({orders.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#202127] uppercase tracking-wider text-[#969faf]">
                <th className="py-2.5 px-5 font-medium">Time</th>
                <th className="py-2.5 px-5 font-medium">Market</th>
                <th className="py-2.5 px-5 font-medium">Type</th>
                <th className="py-2.5 px-5 font-medium">Side</th>
                <th className="py-2.5 px-5 font-medium text-right">Price</th>
                <th className="py-2.5 px-5 font-medium text-right">Filled / Qty</th>
                <th className="py-2.5 px-5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202127]/60 font-mono">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center font-sans text-[#969faf]">
                    No orders yet
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-[#1a1c24]">
                    <td className="py-3 px-5 text-[#969faf]">{new Date(o.createdAt).toLocaleString()}</td>
                    <td className="py-3 px-5 font-sans font-medium text-[#f4f4f6]">{o.stock.symbol}/USD</td>
                    <td className="py-3 px-5 text-[#969faf]">{o.type}</td>
                    <td className={`py-3 px-5 font-semibold ${o.side === "BUY" ? "text-[#00c278]" : "text-[#fd4b4e]"}`}>
                      {o.side}
                    </td>
                    <td className="py-3 px-5 text-right text-[#f4f4f6]">
                      {o.price ? `$${Number(o.price).toFixed(2)}` : "Market"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#f4f4f6]">
                      {Number(o.filledQty)} / {Number(o.qty)}
                    </td>
                    <td className="py-3 px-5 text-right text-[#969faf]">{o.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
