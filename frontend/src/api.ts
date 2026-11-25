const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Market {
  id: string;
  symbol: string;
  name: string;
}

export interface Depth {
  market: string;
  bids: [number, number][];
  asks: [number, number][];
}

export interface PublicTrade {
  id: string;
  price: number;
  qty: number;
  createdAt: string;
}

export interface Holding {
  available: number;
  locked: number;
}

export type Balances = Record<string, Holding>;

export interface OrderRecord {
  id: string;
  type: "MARKET" | "LIMIT";
  side: "BUY" | "SELL";
  price: string | null;
  qty: string;
  filledQty: string;
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  createdAt: string;
  stock: { symbol: string; name: string };
}

export interface FillRecord {
  id: string;
  orderId: string;
  price: string;
  qty: string;
  side: "BUY" | "SELL";
  createdAt: string;
  stock: { symbol: string; name: string };
}

export interface PlaceOrderPayload {
  type: "market" | "limit";
  side: "buy" | "sell";
  market_id: string;
  price: number | null;
  qty: number;
}

export interface PlaceOrderResponse {
  message: string;
  orderId: string;
  status: string;
  filledQty: number;
  averagePrice: number | null;
  fills: { price: number; qty: number }[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getMarkets: () => request<{ markets: Market[] }>("/markets"),
  getDepth: (symbol: string) => request<Depth>(`/depth/${symbol}`),
  getTrades: (symbol: string) => request<{ market: string; trades: PublicTrade[] }>(`/trades/${symbol}`),

  signup: (username: string, password: string) =>
    request<{ userId: string; username: string; token: string }>("/signup", {
      method: "POST",
      body: { username, password },
    }),

  signin: (username: string, password: string) =>
    request<{ userId: string; username: string; token: string }>("/signin", {
      method: "POST",
      body: { username, password },
    }),

  onramp: (token: string, asset: string, amount: number) =>
    request<{ balances: Balances }>("/onramp", {
      method: "POST",
      token,
      body: { asset, amount },
    }),

  getBalances: (token: string) => request<{ balances: Balances }>("/balance", { token }),

  placeOrder: (token: string, payload: PlaceOrderPayload) =>
    request<PlaceOrderResponse>("/order", { method: "POST", token, body: payload }),

  cancelOrder: (token: string, orderId: string) =>
    request<{ message: string }>(`/order/${orderId}`, { method: "DELETE", token }),

  getOrders: (token: string) => request<{ orders: OrderRecord[] }>("/orders", { token }),
  getOpenOrders: (token: string) => request<{ orders: OrderRecord[] }>("/orders/open", { token }),
  getFills: (token: string) => request<{ fills: FillRecord[] }>("/fills", { token }),
};
