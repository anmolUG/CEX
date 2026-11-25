import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

const ASSETS = [
  { symbol: "USD", label: "US Dollar", presets: [100, 1000, 10000] },
  { symbol: "SOL", label: "Solana", presets: [5, 25, 100] },
  { symbol: "BTC", label: "Bitcoin", presets: [0.1, 1, 5] },
];

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { user, refreshBalances } = useAuth();
  const [asset, setAsset] = useState("USD");
  const [amount, setAmount] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!open) return null;

  const currentAsset = ASSETS.find((a) => a.symbol === asset) ?? ASSETS[0]!;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.token) return;
    setError(null);
    setSuccess(null);

    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter a positive amount");
      return;
    }

    setLoading(true);
    try {
      await api.onramp(user.token, asset, numeric);
      await refreshBalances();
      setSuccess(`Deposited ${numeric} ${asset}`);
      setTimeout(() => {
        setSuccess(null);
        onClose();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#14151b] border border-[#202127] p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#f4f4f6]">Deposit Test Funds</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#969faf] hover:text-[#f4f4f6] hover:bg-[#202127] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[#969faf] mb-1.5">Asset</label>
            <div className="grid grid-cols-3 gap-2">
              {ASSETS.map((a) => (
                <button
                  type="button"
                  key={a.symbol}
                  onClick={() => {
                    setAsset(a.symbol);
                    setAmount(String(a.presets[1]));
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    asset === a.symbol
                      ? "bg-[#202127] border-[#4c94ff] text-[#f4f4f6]"
                      : "bg-[#0e0f14] border-[#202127] text-[#969faf] hover:text-[#f4f4f6]"
                  }`}
                >
                  {a.symbol}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#969faf] mb-1.5">Amount ({asset})</label>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg bg-[#0e0f14] border border-[#202127] focus:border-[#4c94ff] outline-none px-3 py-2.5 text-sm font-mono text-[#f4f4f6]"
              placeholder="0.00"
            />
            <div className="flex gap-2 mt-2">
              {currentAsset.presets.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setAmount(String(p))}
                  className="flex-1 py-1 rounded-md bg-[#0e0f14] border border-[#202127] hover:border-[#343742] text-xs font-mono text-[#969faf] hover:text-[#f4f4f6] cursor-pointer"
                >
                  +{p}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-[#fd4b4e]">{error}</p>}
          {success && <p className="text-xs text-[#00c278]">{success}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#00c278] hover:bg-[#00d484] disabled:opacity-50 text-[#0e0f14] font-semibold text-sm transition-colors cursor-pointer"
          >
            {loading ? "Depositing..." : `Deposit ${asset}`}
          </button>
        </form>
      </div>
    </div>
  );
}
