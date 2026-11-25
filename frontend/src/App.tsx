import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Navbar } from "./components/Navbar";
import { DepositModal } from "./components/DepositModal";
import { MarketsPage } from "./pages/MarketsPage";
import { TradePage } from "./pages/TradePage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { AuthPage } from "./pages/AuthPage";

export function App() {
  const [depositOpen, setDepositOpen] = useState(false);

  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-[#0e0f14] text-[#f4f4f6]">
          <Navbar onOpenDeposit={() => setDepositOpen(true)} />
          <Routes>
            <Route path="/" element={<Navigate to="/trade/SOL" replace />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route
              path="/trade/:symbol"
              element={<TradePage onOpenDeposit={() => setDepositOpen(true)} />}
            />
            <Route
              path="/portfolio"
              element={<PortfolioPage onOpenDeposit={() => setDepositOpen(true)} />}
            />
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
          </Routes>
          <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
