import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface AuthPageProps {
  mode: "signin" | "signup";
}

export function AuthPage({ mode }: AuthPageProps) {
  const { signin, signup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isSignup) {
        await signup(username.trim(), password);
      } else {
        await signin(username.trim(), password);
      }
      navigate("/trade/SOL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#14151b] border border-[#202127] p-6">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0ea5e9] to-[#2563eb] shadow-sm shadow-[#0ea5e9]/25 flex items-center justify-center font-bold text-white">
            C
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#f4f4f6]">
              {isSignup ? "Create your account" : "Sign in to Cove"}
            </h1>
            <p className="text-xs text-[#969faf]">Spot trading with instant order matching</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[#969faf] mb-1.5">Username</label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="trader123"
              className="w-full rounded-lg bg-[#0e0f14] border border-[#202127] focus:border-[#4c94ff] outline-none px-3 py-2.5 text-sm text-[#f4f4f6]"
            />
          </div>

          <div>
            <label className="block text-xs text-[#969faf] mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg bg-[#0e0f14] border border-[#202127] focus:border-[#4c94ff] outline-none px-3 py-2.5 text-sm text-[#f4f4f6]"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-[#fd4b4e]/10 border border-[#fd4b4e]/30 px-3 py-2 text-xs text-[#fd4b4e]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#f4f4f6] hover:bg-white disabled:opacity-50 text-[#0e0f14] font-semibold text-sm transition-colors cursor-pointer"
          >
            {loading ? "Please wait..." : isSignup ? "Sign up" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[#969faf]">
          {isSignup ? "Already have an account?" : "New to Cove?"}{" "}
          <Link
            to={isSignup ? "/signin" : "/signup"}
            className="text-[#4c94ff] hover:underline font-medium"
          >
            {isSignup ? "Sign in" : "Create account"}
          </Link>
        </p>
      </div>
    </div>
  );
}
