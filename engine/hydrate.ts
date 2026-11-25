/**
 * On startup, rebuild the engine's in-memory state (balances + open orders)
 * from Postgres so the engine survives restarts.
 *
 * Balance reconstruction:
 *   available = Σ deposits  ±  Σ fills  −  locked
 *   locked    = Σ remaining qty of each open order (USD for buys, stock for sells)
 *
 * Limitation: fills that the engine executed but that the backend did not
 * persist before a crash are lost. Those orders will reappear as OPEN here
 * and can be re-matched or cancelled by the user.
 */
import { Pool } from "pg";
import type { HydrationState, Side, OrderType } from "./engine";

// Must match the scales in backend/units.ts
const PRICE_SCALE = 100;       // 10^PRICE_DECIMALS
const QTY_SCALE   = 10_000;    // 10^QTY_DECIMALS
const USD_SCALE   = 1_000_000; // 10^(PRICE_DECIMALS + QTY_DECIMALS)

function assetScale(asset: string): number {
    return asset === "USD" ? USD_SCALE : QTY_SCALE;
}

function ensureHolding(
    balances: HydrationState["balances"],
    userId: string,
    asset: string,
    markets: string[]
) {
    if (!balances[userId]) {
        balances[userId] = { USD: { available: 0, locked: 0 } };
        for (const m of markets) {
            balances[userId]![m] = { available: 0, locked: 0 };
        }
    }
    if (!balances[userId]![asset]) {
        balances[userId]![asset] = { available: 0, locked: 0 };
    }
    return balances[userId]![asset]!;
}

export async function loadStateFromDb(
    databaseUrl: string,
    markets: string[]
): Promise<HydrationState> {
    const pool = new Pool({ connectionString: databaseUrl });

    try {
        // ---- 1. deposits -------------------------------------------------
        const { rows: deposits } = await pool.query<{
            userId: string; asset: string; amount: string;
        }>('SELECT "userId", asset, amount FROM "Deposit"');

        // ---- 2. fills ----------------------------------------------------
        const { rows: fills } = await pool.query<{
            userId: string; market: string; price: string; qty: string; side: string;
        }>(
            `SELECT f."userId", s.symbol AS market, f.price, f.qty, f.side
             FROM "Fill" f
             JOIN "Stock" s ON f."stockId" = s.id`
        );

        // ---- 3. open / partially-filled orders ---------------------------
        const { rows: dbOrders } = await pool.query<{
            id: string; userId: string; market: string; type: string;
            side: string; price: string | null; qty: string; filledQty: string;
        }>(
            `SELECT o.id, o."userId", s.symbol AS market, o.type, o.side,
                    o.price, o.qty, o."filledQty"
             FROM "Order" o
             JOIN "Stock" s ON o."stockId" = s.id
             WHERE o.status IN ('OPEN', 'PARTIALLY_FILLED')
             ORDER BY o."createdAt" ASC`
        );

        // ---- 4. fill count → last trade ID ------------------------------
        const { rows: countRows } = await pool.query<{ count: string }>(
            'SELECT COUNT(*) AS count FROM "Fill"'
        );
        // Each trade creates 2 fill rows (taker + maker).
        const lastTradeId = Math.ceil(parseInt(countRows[0]?.count ?? "0", 10) / 2);

        // ---- build balances ---------------------------------------------
        const balances: HydrationState["balances"] = {};

        for (const d of deposits) {
            const h = ensureHolding(balances, d.userId, d.asset, markets);
            h.available += Math.round(parseFloat(d.amount) * assetScale(d.asset));
        }

        for (const f of fills) {
            const price = Math.round(parseFloat(f.price) * PRICE_SCALE);
            const qty   = Math.round(parseFloat(f.qty)   * QTY_SCALE);
            const usd   = price * qty;

            if (f.side === "BUY") {
                ensureHolding(balances, f.userId, "USD", markets).available -= usd;
                ensureHolding(balances, f.userId, f.market, markets).available += qty;
            } else {
                ensureHolding(balances, f.userId, "USD", markets).available += usd;
                ensureHolding(balances, f.userId, f.market, markets).available -= qty;
            }
        }

        // ---- build open orders & lock funds -----------------------------
        const openOrders: HydrationState["openOrders"] = dbOrders.map((o) => {
            const side: Side = o.side === "BUY" ? "buy" : "sell";
            const orderType: OrderType = o.type === "MARKET" ? "market" : "limit";
            const price = o.price !== null ? Math.round(parseFloat(o.price) * PRICE_SCALE) : null;
            const qty       = Math.round(parseFloat(o.qty)       * QTY_SCALE);
            const filledQty = Math.round(parseFloat(o.filledQty) * QTY_SCALE);
            const remaining = qty - filledQty;

            if (side === "buy" && price !== null) {
                const locked = price * remaining;
                const h = ensureHolding(balances, o.userId, "USD", markets);
                h.available -= locked;
                h.locked    += locked;
            } else if (side === "sell") {
                const h = ensureHolding(balances, o.userId, o.market, markets);
                h.available -= remaining;
                h.locked    += remaining;
            }

            return { orderId: o.id, userId: o.userId, market: o.market, side, orderType, price, qty, filledQty };
        });

        console.log(
            `DB state loaded: ${deposits.length} deposits, ${fills.length} fills, ` +
            `${openOrders.length} open orders, ${Object.keys(balances).length} users`
        );

        return { balances, openOrders, lastTradeId };
    } finally {
        await pool.end();
    }
}
