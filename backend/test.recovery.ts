import assert from "node:assert/strict";
import fs from "node:fs";

const BASE_URL = process.env.API_URL ?? "http://localhost:3001";
const STATE_FILE = ".recovery-state.json";
const phase = process.argv[2];

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
}

if (phase === "setup") {
    const username = `recovery_${Date.now().toString(36)}`;
    const signup = await api("/signup", { method: "POST", body: { username, password: "password123" } });
    assert.equal(signup.status, 201);
    const token: string = signup.body.token;

    const deposit = await api("/onramp", {
        method: "POST",
        token,
        body: { asset: "USD", amount: 1000 },
    });
    assert.equal(deposit.status, 200);

    const order = await api("/order", {
        method: "POST",
        token,
        body: { type: "limit", side: "buy", market_id: "SOL", price: 50, qty: 4 },
    });
    assert.equal(order.status, 200);
    assert.equal(order.body.status, "OPEN");

    fs.writeFileSync(STATE_FILE, JSON.stringify({ token, orderId: order.body.orderId }));
    console.log(`  PASS  Recovery setup: deposited $1000 and placed OPEN bid (${order.body.orderId})`);
} else if (phase === "verify") {
    const { token, orderId } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as {
        token: string;
        orderId: string;
    };
    fs.unlinkSync(STATE_FILE);

    const usd = await api("/balance/usd", { token });
    assert.equal(usd.status, 200);
    assert.deepEqual(usd.body, { available: 800, locked: 200 });
    console.log("  PASS  After engine restart: USD balance hydrated ($800 available, $200 locked)");

    const depth = await api("/depth/SOL");
    assert.equal(depth.status, 200);
    const bid = depth.body.bids.find(([p]: [number, number]) => p === 50);
    assert.ok(bid && bid[1] >= 4, `Expected bid >= 4 at $50, got ${JSON.stringify(depth.body.bids)}`);
    console.log("  PASS  After engine restart: open bid hydrated into SOL orderbook");

    const cancel = await api(`/order/${orderId}`, { method: "DELETE", token });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.order.status, "CANCELLED");

    const usdAfter = await api("/balance/usd", { token });
    assert.deepEqual(usdAfter.body, { available: 1000, locked: 0 });
    console.log("  PASS  After engine restart: cancelling hydrated order unlocked full $1000");
} else {
    throw new Error('Usage: tsx test.recovery.ts <setup|verify>');
}
