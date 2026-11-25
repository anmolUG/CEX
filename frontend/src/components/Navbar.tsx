import { Link, useLocation } from "react-router-dom";
import { ArrowDownToLine, LogOut, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface NavbarProps {
  onOpenDeposit: () => void;
}

export function Navbar({ onOpenDeposit }: NavbarProps) {
  const { user, signout } = useAuth();
  const { pathname } = useLocation();

  const navLink = (to: string, label: string, active: boolean) => (
    <Link
      to={to}
      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        active ? "text-[#f4f4f6] bg-[#202127]" : "text-[#969faf] hover:text-[#f4f4f6]"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="h-14 border-b border-[#202127] bg-[#0e0f14] px-4 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-6">
        <Link to="/trade/SOL" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0ea5e9] to-[#2563eb] shadow-sm shadow-[#0ea5e9]/25 flex items-center justify-center font-bold text-white text-sm tracking-tight">
            C
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-[#f4f4f6]">
            Cove
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navLink("/markets", "Markets", pathname === "/markets" || pathname === "/")}
          {navLink("/trade/SOL", "Trade", pathname.startsWith("/trade"))}
          {navLink("/portfolio", "Portfolio", pathname === "/portfolio")}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        {user ? (
          <>
            <button
              onClick={onOpenDeposit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00c278]/15 text-[#00c278] hover:bg-[#00c278]/25 text-xs font-semibold transition-colors cursor-pointer"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              Deposit
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#14151b] border border-[#202127] text-xs text-[#f4f4f6]">
              <User className="w-3.5 h-3.5 text-[#969faf]" />
              <span className="font-medium">{user.username}</span>
            </div>
            <button
              onClick={signout}
              title="Sign out"
              className="p-2 rounded-lg text-[#969faf] hover:text-[#f4f4f6] hover:bg-[#14151b] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <Link
              to="/signin"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-[#f4f4f6] bg-[#14151b] hover:bg-[#202127] border border-[#202127] transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-[#0e0f14] bg-[#f4f4f6] hover:bg-white transition-colors"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
