/**
 * Market-maker seeder: creates 3 accounts, funds them via /onramp,
 * executes a handful of trades so the Price Chart & Trades tab are populated,
 * and seeds ~110 resting limit orders across SOL/USD and BTC/USD.
 *
 * Usage (while engine and backend are running):
 *   npm run seed
 */
const BASE_URL = process.env.API_URL ?? "http://localhost:3001";

const MM_ACCOUNTS = [
    { username: "mm_alpha", password: "marketmaker123" },
    { username: "mm_beta", password: "marketmaker123" },
    { username: "mm_gamma", password: "marketmaker123" },
];

async function api<T = any>(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status}: ${data?.error ?? "failed"}`);
    }
    return data as T;
}

async function getOrCreateToken(username: string, password: string): Promise<string> {
    try {
        const res = await api<{ token: string }>("/signup", {
            method: "POST",
            body: { username, password },
        });
        console.log(`  Created account: ${username}`);
        return res.token;
    } catch {
        const res = await api<{ token: string }>("/signin", {
            method: "POST",
            body: { username, password },
        });
        console.log(`  Signed in existing account: ${username}`);
        return res.token;
    }
}

// Deterministic pseudo-random helper so sizes look natural
let seed = 42;
function rand(min: number, max: number, decimals = 2): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const val = min + (seed / 4294967296) * (max - min);
    return Number(val.toFixed(decimals));
}

async function seedMarket(
    tokens: string[],
    config: {
        symbol: string;
        tradePrices: number[];
        tradeQtyRange: [number, number];
        mid: number;
        step: number;
        levels: number;
        qtyRange: [number, number];
        qtyDecimals: number;
    }
) {
    const { symbol, tradePrices, tradeQtyRange, mid, step, levels, qtyRange, qtyDecimals } = config;
    console.log(`\nSeeding ${symbol}/USD...`);

    // 1. Seed recent matched trades (populates Price Chart & Trades tab)
    let tradeCount = 0;
    for (let i = 0; i < tradePrices.length; i++) {
        const price = tradePrices[i]!;
        const qty = rand(tradeQtyRange[0], tradeQtyRange[1], qtyDecimals);
        const seller = tokens[i % tokens.length]!;
        const buyer = tokens[(i + 1) % tokens.length]!;

        await api("/order", {
            method: "POST",
            token: seller,
            body: { type: "limit", side: "sell", market_id: symbol, price, qty },
        });
        await api("/order", {
            method: "POST",
            token: buyer,
            body: { type: "limit", side: "buy", market_id: symbol, price, qty },
        });
        tradeCount++;
    }
    console.log(`  Executed ${tradeCount} trades`);

    // 2. Seed resting asks above mid & bids below mid (2 orders on some levels for realism)
    let restingCount = 0;
    for (let i = 1; i <= levels; i++) {
        const offset = i * step + (i > 10 ? (i - 10) * step * 0.5 : 0);
        const askPrice = Number((mid + offset).toFixed(2));
        const bidPrice = Number((mid - offset).toFixed(2));

        const ordersAtLevel = i <= 6 ? 2 : 1;
        for (let k = 0; k < ordersAtLevel; k++) {
            const askQty = rand(qtyRange[0], qtyRange[1], qtyDecimals);
            const bidQty = rand(qtyRange[0], qtyRange[1], qtyDecimals);
            const askToken = tokens[(i + k) % tokens.length]!;
            const bidToken = tokens[(i + k + 1) % tokens.length]!;

            await api("/order", {
                method: "POST",
                token: askToken,
                body: { type: "limit", side: "sell", market_id: symbol, price: askPrice, qty: askQty },
            });
            await api("/order", {
                method: "POST",
                token: bidToken,
                body: { type: "limit", side: "buy", market_id: symbol, price: bidPrice, qty: bidQty },
            });
            restingCount += 2;
        }
    }
    console.log(`  Placed ${restingCount} resting limit orders (${levels} bid & ${levels} ask levels)`);
}

async function main() {
    console.log(`Connecting to ${BASE_URL}...`);
    const tokens: string[] = [];

    for (const acc of MM_ACCOUNTS) {
        const token = await getOrCreateToken(acc.username, acc.password);
        tokens.push(token);

        await api("/onramp", { method: "POST", token, body: { asset: "USD", amount: 2_500_000 } });
        await api("/onramp", { method: "POST", token, body: { asset: "SOL", amount: 2_500 } });
        await api("/onramp", { method: "POST", token, body: { asset: "BTC", amount: 40 } });
    }
    console.log("Funded all 3 market-maker accounts with USD, SOL, and BTC.");

    // Check current SOL book so we don't accidentally cross existing user orders awkwardly;
    // still seed around a clean realistic price range.
    await seedMarket(tokens, {
        symbol: "SOL",
        tradePrices: [
            112.4, 112.85, 112.6, 113.1, 113.55, 113.3, 113.9, 114.25,
            114.0, 114.45, 114.8, 114.65, 115.1, 114.95, 115.2,
        ],
        tradeQtyRange: [1.5, 18],
        mid: 115.2,
        step: 0.25,
        levels: 22,
        qtyRange: [2, 38],
        qtyDecimals: 2,
    });

    await seedMarket(tokens, {
        symbol: "BTC",
        tradePrices: [
            91420, 91510, 91460, 91640, 91780, 91710, 91890, 91950,
            91880, 92040, 92150, 92090, 92210, 92180, 92260,
        ],
        tradeQtyRange: [0.04, 0.35],
        mid: 92260,
        step: 35,
        levels: 20,
        qtyRange: [0.05, 1.4],
        qtyDecimals: 4,
    });

    console.log("\nDone! Orderbooks and recent trades are seeded.");
}

main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
