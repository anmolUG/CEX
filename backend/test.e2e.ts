import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL ?? "http://localhost:3001";
const RUN_ID = Date.now().toString(36);

interface ApiResult {
    status: number;
    body: any;
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<ApiResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

    const res = await fetch(`${BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    let body: any = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { status: res.status, body };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        console.error(`  FAIL  ${name}`);
        throw err;
    }
}

console.log(`Running E2E backend tests against ${BASE_URL} (run=${RUN_ID})\n`);

let aliceToken = "";
let bobToken = "";
let bobSellOrderId = "";
let aliceBuyOrderId = "";

// ------------------------------------------------------------------ 0. Markets & CORS
await test("GET /markets returns configured markets with CORS headers", async () => {
    const raw = await fetch(`${BASE_URL}/markets`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get("access-control-allow-origin"), "*");
    const body = (await raw.json()) as { markets: Array<{ symbol: string }> };
    const symbols = body.markets.map((m) => m.symbol).sort();
    assert.deepEqual(symbols, ["BTC", "SOL"]);
});

// ------------------------------------------------------------------ 1. Auth
await test("POST /signup creates two new users", async () => {
    const alice = await api("/signup", {
        method: "POST",
        body: { username: `alice_${RUN_ID}`, password: "password123" },
    });
    assert.equal(alice.status, 201, JSON.stringify(alice.body));
    assert.ok(alice.body.token);
    assert.ok(alice.body.userId);
    aliceToken = alice.body.token;

    const bob = await api("/signup", {
        method: "POST",
        body: { username: `bob_${RUN_ID}`, password: "password123" },
    });
    assert.equal(bob.status, 201, JSON.stringify(bob.body));
    assert.ok(bob.body.token);
    bobToken = bob.body.token;
});

await test("POST /signup rejects duplicate username with 409", async () => {
    const res = await api("/signup", {
        method: "POST",
        body: { username: `alice_${RUN_ID}`, password: "password123" },
    });
    assert.equal(res.status, 409);
});

await test("POST /signin succeeds with valid password and rejects wrong password", async () => {
    const ok = await api("/signin", {
        method: "POST",
        body: { username: `alice_${RUN_ID}`, password: "password123" },
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);

    const bad = await api("/signin", {
        method: "POST",
        body: { username: `alice_${RUN_ID}`, password: "wrong" },
    });
    assert.equal(bad.status, 401);
});

await test("Protected routes reject missing or invalid token with 401", async () => {
    const noAuth = await api("/balance");
    assert.equal(noAuth.status, 401);

    const badAuth = await api("/balance", { token: "invalid.token.here" });
    assert.equal(badAuth.status, 401);
});

// ------------------------------------------------------ 2. Onramp & Balances
await test("GET /balance and /balance/usd return 0 initially", async () => {
    const usd = await api("/balance/usd", { token: aliceToken });
    assert.equal(usd.status, 200);
    assert.deepEqual(usd.body, { available: 0, locked: 0 });

    const all = await api("/balance", { token: aliceToken });
    assert.equal(all.status, 200);
    assert.equal(all.body.balances.SOL.available, 0);
});

await test("POST /onramp credits USD to Alice and SOL to Bob", async () => {
    const r1 = await api("/onramp", {
        method: "POST",
        token: aliceToken,
        body: { asset: "USD", amount: 5000 },
    });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.balances.USD.available, 5000);

    const r2 = await api("/onramp", {
        method: "POST",
        token: bobToken,
        body: { asset: "SOL", amount: 20 },
    });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r2.body.balances.SOL.available, 20);
});

// ------------------------------------------------ 3. Limit & Market Matching
await test("POST /order places resting limit sell and locks Bob's SOL", async () => {
    const res = await api("/order", {
        method: "POST",
        token: bobToken,
        body: { type: "limit", side: "sell", market_id: "SOL", price: 100, qty: 10 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "OPEN");
    assert.equal(res.body.filledQty, 0);
    bobSellOrderId = res.body.orderId;

    const bobBal = await api("/balance", { token: bobToken });
    assert.deepEqual(bobBal.body.balances.SOL, { available: 10, locked: 10 });
});

await test("GET /depth/SOL shows Bob's resting ask", async () => {
    const res = await api("/depth/SOL");
    assert.equal(res.status, 200);
    const level = res.body.asks.find(([p]: [number, number]) => p === 100);
    assert.ok(level && level[1] >= 10, `Expected ask >= 10 at 100, got ${JSON.stringify(res.body.asks)}`);
});

await test("POST /order matches Alice's limit buy at maker price (100) and refunds price improvement", async () => {
    const res = await api("/order", {
        method: "POST",
        token: aliceToken,
        body: { type: "limit", side: "buy", market_id: "SOL", price: 105, qty: 4 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "FILLED");
    assert.equal(res.body.filledQty, 4);
    assert.equal(res.body.averagePrice, 100);
    aliceBuyOrderId = res.body.orderId;

    const aliceBal = await api("/balance", { token: aliceToken });
    assert.deepEqual(aliceBal.body.balances.USD, { available: 4600, locked: 0 });
    assert.deepEqual(aliceBal.body.balances.SOL, { available: 4, locked: 0 });

    const bobBal = await api("/balance", { token: bobToken });
    assert.deepEqual(bobBal.body.balances.USD, { available: 400, locked: 0 });
    assert.deepEqual(bobBal.body.balances.SOL, { available: 10, locked: 6 });
});

await test("POST /order matches Alice's market buy against remaining ask", async () => {
    const res = await api("/order", {
        method: "POST",
        token: aliceToken,
        body: { type: "market", side: "buy", market_id: "SOL", qty: 2 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "FILLED");
    assert.equal(res.body.filledQty, 2);
    assert.equal(res.body.averagePrice, 100);
});

// -------------------------------------------------- 4. Order & Fill Queries
await test("GET /order/:orderId returns order status and individual fills", async () => {
    const res = await api(`/order/${bobSellOrderId}`, { token: bobToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.order.status, "PARTIALLY_FILLED");
    assert.equal(Number(res.body.order.filledQty), 6);
    assert.equal(res.body.order.fills.length, 2);

    // Other user cannot view Bob's order
    const forbidden = await api(`/order/${bobSellOrderId}`, { token: aliceToken });
    assert.equal(forbidden.status, 404);
});

await test("GET /orders, /orders/open, and /fills return persisted history", async () => {
    const allOrders = await api("/orders", { token: aliceToken });
    assert.equal(allOrders.status, 200);
    assert.equal(allOrders.body.orders.length, 2);

    const openAlice = await api("/orders/open", { token: aliceToken });
    assert.equal(openAlice.status, 200);
    assert.equal(openAlice.body.orders.length, 0);

    const openBob = await api("/orders/open", { token: bobToken });
    assert.equal(openBob.status, 200);
    assert.equal(openBob.body.orders.length, 1);
    assert.equal(openBob.body.orders[0].id, bobSellOrderId);

    const aliceFills = await api("/fills", { token: aliceToken });
    assert.equal(aliceFills.status, 200);
    assert.equal(aliceFills.body.fills.length, 2);
});

// ------------------------------------------------------------ 5. Cancel
await test("DELETE /order/:orderId cancels remaining order and unlocks funds", async () => {
    const res = await api(`/order/${bobSellOrderId}`, {
        method: "DELETE",
        token: bobToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.status, "CANCELLED");
    assert.equal(res.body.remainingQty, 4);

    const bobBal = await api("/balance", { token: bobToken });
    assert.deepEqual(bobBal.body.balances.SOL, { available: 14, locked: 0 });
});

// ------------------------------------------------------------ 6. Error cases
await test("Error handling: insufficient balance, unknown market, double cancel", async () => {
    const noFunds = await api("/order", {
        method: "POST",
        token: aliceToken,
        body: { type: "limit", side: "buy", market_id: "SOL", price: 10000, qty: 10 },
    });
    assert.equal(noFunds.status, 400);

    const badMarket = await api("/order", {
        method: "POST",
        token: aliceToken,
        body: { type: "limit", side: "buy", market_id: "DOGE", price: 1, qty: 1 },
    });
    assert.equal(badMarket.status, 404);

    const doubleCancel = await api(`/order/${bobSellOrderId}`, {
        method: "DELETE",
        token: bobToken,
    });
    assert.equal(doubleCancel.status, 400);
});

console.log(`\nAll ${passed} E2E backend tests passed!`);
