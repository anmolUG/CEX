import assert from "node:assert/strict";
import { Engine, EngineError } from "./engine";

const e = new Engine(["SOL", "BTC"]);
const p = (m: Record<string, unknown>) => e.process(m) as any;
const bal = (u: string) => p({ type: "get_user_balance", userId: u });
const total = (asset: string) =>
  ["alice", "bob", "carol"].reduce((s, u) => s + bal(u)[asset].available + bal(u)[asset].locked, 0);

p({ type: "deposit", userId: "alice", asset: "USD", amount: 1_000_000 });
p({ type: "deposit", userId: "bob", asset: "SOL", amount: 100 });
p({ type: "deposit", userId: "carol", asset: "SOL", amount: 100 });

// 1. resting ask
let r = p({ type: "create_order", orderId: "b1", userId: "bob", market: "SOL", side: "sell", orderType: "limit", price: 100, qty: 10 });
assert.equal(r.status, "OPEN");
assert.deepEqual(bal("bob").SOL, { available: 90, locked: 10 });

// 2. same price, later time -> lower priority
p({ type: "create_order", orderId: "c1", userId: "carol", market: "SOL", side: "sell", orderType: "limit", price: 100, qty: 5 });

// 3. limit buy above ask -> executes at maker price, refund improvement
r = p({ type: "create_order", orderId: "a1", userId: "alice", market: "SOL", side: "buy", orderType: "limit", price: 105, qty: 4 });
assert.equal(r.status, "FILLED");
assert.equal(r.fills[0].makerOrderId, "b1");
assert.equal(r.fills[0].price, 100);
assert.deepEqual(bal("alice").USD, { available: 1_000_000 - 400, locked: 0 });
assert.deepEqual(bal("alice").SOL, { available: 4, locked: 0 });
assert.deepEqual(bal("bob").USD, { available: 400, locked: 0 });

assert.deepEqual(p({ type: "get_depth", market: "SOL" }).asks, [[100, 11]]);

// 4. market buy sweeps bob then carol (time priority)
r = p({ type: "create_order", orderId: "a2", userId: "alice", market: "SOL", side: "buy", orderType: "market", qty: 20 });
assert.equal(r.filledQty, 11);
assert.equal(r.status, "CANCELLED"); // IOC remainder
assert.deepEqual(r.fills.map((f: any) => [f.makerOrderId, f.qty]), [["b1", 6], ["c1", 5]]);
assert.deepEqual(p({ type: "get_depth", market: "SOL" }).asks, []);

// 5. resting bid, partial fill by market sell, then cancel
p({ type: "create_order", orderId: "a3", userId: "alice", market: "SOL", side: "buy", orderType: "limit", price: 90, qty: 5 });
r = p({ type: "create_order", orderId: "b2", userId: "bob", market: "SOL", side: "sell", orderType: "market", qty: 2 });
assert.equal(r.status, "FILLED");
assert.equal(r.fills[0].makerStatus, "PARTIALLY_FILLED");
assert.deepEqual(p({ type: "get_depth", market: "SOL" }).bids, [[90, 3]]);
assert.equal(p({ type: "get_open_orders", userId: "alice" }).length, 1);
r = p({ type: "cancel_order", orderId: "a3", userId: "alice" });
assert.equal(r.remainingQty, 3);
assert.equal(bal("alice").USD.locked, 0);
assert.equal(p({ type: "get_order", orderId: "a3", userId: "alice" }).status, "CANCELLED");

// 6. errors
assert.throws(() => p({ type: "create_order", orderId: "x", userId: "carol", market: "SOL", side: "buy", orderType: "limit", price: 1000, qty: 1 }), /Insufficient USD/);
assert.throws(() => p({ type: "create_order", orderId: "y", userId: "alice", market: "SOL", side: "sell", orderType: "limit", price: 1, qty: 1000 }), /Insufficient SOL/);
assert.throws(() => p({ type: "cancel_order", orderId: "a3", userId: "alice" }), EngineError);
assert.throws(() => p({ type: "cancel_order", orderId: "b1", userId: "alice" }), EngineError);
assert.throws(() => p({ type: "get_depth", market: "DOGE" }), EngineError);

// 7. conservation of funds
assert.equal(total("USD"), 1_000_000);
assert.equal(total("SOL"), 200);

console.log("All engine unit tests passed!");
