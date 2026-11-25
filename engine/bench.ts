import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Engine } from "./engine";

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx]!;
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
}

function fmtUs(ms: number): string {
    return `${(ms * 1000).toFixed(2)} µs`;
}

// Fast deterministic PRNG
let rng = 1337;
function nextInt(min: number, max: number): number {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return min + (rng % (max - min + 1));
}

function setupFundedEngine(users: string[]): Engine {
    const engine = new Engine(["SOL", "BTC"]);
    for (const u of users) {
        engine.process({ type: "deposit", userId: u, asset: "USD", amount: 1_000_000_000_000 });
        engine.process({ type: "deposit", userId: u, asset: "SOL", amount: 100_000_000 });
    }
    return engine;
}

// ------------------------------------------------------------ Warmup
{
    const warm = setupFundedEngine(["w1", "w2"]);
    for (let i = 0; i < 5_000; i++) {
        warm.process({
            type: "create_order",
            orderId: `ws-${i}`,
            userId: "w1",
            market: "SOL",
            side: "sell",
            orderType: "limit",
            price: 10000 + (i % 50),
            qty: 10,
        });
        warm.process({
            type: "create_order",
            orderId: `wb-${i}`,
            userId: "w2",
            market: "SOL",
            side: "buy",
            orderType: "limit",
            price: 10000 + (i % 50),
            qty: 10,
        });
    }
}

console.log("=== Cove Matching Engine Benchmark (Node.js in-memory) ===\n");

// -------------------------------------------------- 1. Pure Matching (Crossing)
{
    const N = 50_000; // 25k maker + 25k taker = 50k orders
    const engine = setupFundedEngine(["maker", "taker"]);
    const latencies: number[] = [];
    let totalFills = 0;

    // Seed an active book of 200 levels first
    for (let i = 0; i < 200; i++) {
        engine.process({
            type: "create_order",
            orderId: `seed-${i}`,
            userId: "maker",
            market: "SOL",
            side: "sell",
            orderType: "limit",
            price: 10000 + (i % 40),
            qty: 100,
        });
    }

    const startAll = performance.now();
    for (let i = 0; i < N / 2; i++) {
        const price = 10000 + (i % 40);

        const t0 = performance.now();
        engine.process({
            type: "create_order",
            orderId: `m-${i}`,
            userId: "maker",
            market: "SOL",
            side: "sell",
            orderType: "limit",
            price,
            qty: 50,
        });
        const t1 = performance.now();
        latencies.push(t1 - t0);

        const t2 = performance.now();
        const res = engine.process({
            type: "create_order",
            orderId: `t-${i}`,
            userId: "taker",
            market: "SOL",
            side: "buy",
            orderType: "limit",
            price: price + 5,
            qty: 50,
        }) as { fills: unknown[] };
        const t3 = performance.now();
        latencies.push(t3 - t2);
        totalFills += res.fills.length;
    }
    const elapsedMs = performance.now() - startAll;
    latencies.sort((a, b) => a - b);

    // Conservation of funds check
    const mb = engine.process({ type: "get_user_balance", userId: "maker" }) as Record<string, { available: number; locked: number }>;
    const tb = engine.process({ type: "get_user_balance", userId: "taker" }) as Record<string, { available: number; locked: number }>;
    assert.equal(mb.USD!.available + mb.USD!.locked + tb.USD!.available + tb.USD!.locked, 2_000_000_000_000);
    assert.equal(mb.SOL!.available + mb.SOL!.locked + tb.SOL!.available + tb.SOL!.locked, 200_000_000);

    console.log("1) Crossing / Matching Workload (50,000 orders)");
    console.log(`   Total time : ${elapsedMs.toFixed(1)} ms`);
    console.log(`   Throughput : ${fmt((N / elapsedMs) * 1000)} orders/sec`);
    console.log(`   Fills      : ${fmt(totalFills)} (${fmt((totalFills / elapsedMs) * 1000)} fills/sec)`);
    console.log(
        `   Latency    : p50=${fmtUs(percentile(latencies, 50))} | p95=${fmtUs(percentile(latencies, 95))} | p99=${fmtUs(percentile(latencies, 99))}\n`
    );
}

// -------------------------------------------------- 2. Mixed Realistic Workload
{
    const OPS = 100_000;
    const users = ["u1", "u2", "u3", "u4"];
    const engine = setupFundedEngine(users);
    const openIds: Array<{ orderId: string; userId: string }> = [];
    const latencies: number[] = [];
    let fills = 0;
    let cancels = 0;
    let depths = 0;

    const memBefore = process.memoryUsage().heapUsed;
    const startAll = performance.now();

    for (let i = 0; i < OPS; i++) {
        const roll = nextInt(1, 100);
        const userId = users[i % users.length]!;
        const t0 = performance.now();

        if (roll <= 5) {
            engine.process({ type: "get_depth", market: "SOL" });
            depths++;
        } else if (roll <= 20 && openIds.length > 0) {
            const idx = nextInt(0, openIds.length - 1);
            const target = openIds[idx]!;
            openIds[idx] = openIds[openIds.length - 1]!;
            openIds.pop();
            try {
                engine.process({ type: "cancel_order", orderId: target.orderId, userId: target.userId });
                cancels++;
            } catch {
                // Already filled
            }
        } else {
            const isBuy = nextInt(0, 1) === 1;
            const aggressive = roll > 65; // ~35% crossing, ~45% resting
            const price = isBuy
                ? aggressive
                    ? nextInt(10000, 10015)
                    : nextInt(9950, 9999)
                : aggressive
                  ? nextInt(9985, 10000)
                  : nextInt(10001, 10050);

            const orderId = `mix-${i}`;
            const res = engine.process({
                type: "create_order",
                orderId,
                userId,
                market: "SOL",
                side: isBuy ? "buy" : "sell",
                orderType: "limit",
                price,
                qty: nextInt(1, 25),
            }) as { status: string; fills: unknown[] };

            fills += res.fills.length;
            if (res.status === "OPEN" || res.status === "PARTIALLY_FILLED") {
                openIds.push({ orderId, userId });
            }
        }

        latencies.push(performance.now() - t0);
    }

    const elapsedMs = performance.now() - startAll;
    const memDeltaMb = (process.memoryUsage().heapUsed - memBefore) / (1024 * 1024);
    latencies.sort((a, b) => a - b);

    console.log("2) Mixed Exchange Workload (100,000 ops: ~45% limit, ~35% match, ~15% cancel, ~5% depth)");
    console.log(`   Total time : ${elapsedMs.toFixed(1)} ms`);
    console.log(`   Throughput : ${fmt((OPS / elapsedMs) * 1000)} ops/sec`);
    console.log(`   Stats      : ${fmt(fills)} fills, ${fmt(cancels)} cancels, ${fmt(depths)} depth reads`);
    console.log(
        `   Latency    : p50=${fmtUs(percentile(latencies, 50))} | p95=${fmtUs(percentile(latencies, 95))} | p99=${fmtUs(percentile(latencies, 99))}`
    );
    console.log(`   Heap delta : ${memDeltaMb.toFixed(1)} MB`);
}
