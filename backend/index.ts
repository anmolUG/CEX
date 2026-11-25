import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Prisma } from "./generated/prisma/client";
import { sendToEngine, EngineRequestError, EngineTimeoutError } from "./untilWeGotBack";
import { prisma } from "./db";
import { authMiddleware, hashPassword, signToken, verifyPassword } from "./auth";
import {
    QUOTE_ASSET,
    ValidationError,
    fromAssetUnits,
    fromPriceUnits,
    fromQtyUnits,
    priceToDb,
    qtyToDb,
    toAssetUnits,
    toPriceUnits,
    toQtyUnits,
} from "./units";

// Must match the markets configured in engine/index.ts
const MARKETS = [
    { symbol: "SOL", name: "Solana" },
    { symbol: "BTC", name: "Bitcoin" },
];

// ---------------------------------------------------------------- engine types

type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";

interface EngineFill {
    tradeId: number;
    price: number;
    qty: number;
    makerOrderId: string;
    makerUserId: string;
    makerFilledQty: number;
    makerStatus: OrderStatus;
}

interface EngineOrderResult {
    orderId: string;
    status: OrderStatus;
    filledQty: number;
    fills: EngineFill[];
}

interface EngineCancelResult {
    orderId: string;
    status: OrderStatus;
    filledQty: number;
    remainingQty: number;
}

interface EngineDepth {
    market: string;
    bids: [number, number][];
    asks: [number, number][];
}

type EngineBalances = Record<string, { available: number; locked: number }>;

// ------------------------------------------------------------------- helpers

function formatBalances(balances: EngineBalances) {
    return Object.fromEntries(
        Object.entries(balances).map(([asset, h]) => [
            asset,
            { available: fromAssetUnits(asset, h.available), locked: fromAssetUnits(asset, h.locked) },
        ])
    );
}

function formatLevels(levels: [number, number][]) {
    return levels.map(([price, qty]) => [fromPriceUnits(price), fromQtyUnits(qty)]);
}

/**
 * Status updates that are safe under concurrent requests: terminal states are
 * written directly, PARTIALLY_FILLED only overrides OPEN.
 */
function statusUpdate(orderId: string, status: OrderStatus): Prisma.PrismaPromise<unknown> | null {
    if (status === "FILLED" || status === "CANCELLED") {
        return prisma.order.update({ where: { id: orderId }, data: { status } });
    }
    if (status === "PARTIALLY_FILLED") {
        return prisma.order.updateMany({ where: { id: orderId, status: "OPEN" }, data: { status } });
    }
    return null;
}

/** Persist the engine's result: taker order, maker orders, and fills (one per side). */
async function persistOrderResult(
    result: EngineOrderResult,
    takerUserId: string,
    stockId: string,
    takerSide: "buy" | "sell"
) {
    const takerSideDb = takerSide === "buy" ? "BUY" : "SELL";
    const makerSideDb = takerSide === "buy" ? "SELL" : "BUY";
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    // filledQty uses increments so concurrent fills on the same order don't overwrite each other.
    if (result.filledQty > 0) {
        ops.push(
            prisma.order.update({
                where: { id: result.orderId },
                data: { filledQty: { increment: qtyToDb(result.filledQty) } },
            })
        );
    }
    const takerStatus = statusUpdate(result.orderId, result.status);
    if (takerStatus) ops.push(takerStatus);

    for (const fill of result.fills) {
        const price = priceToDb(fill.price);
        const qty = qtyToDb(fill.qty);
        ops.push(
            prisma.fill.create({
                data: { orderId: result.orderId, userId: takerUserId, stockId, price, qty, side: takerSideDb },
            }),
            prisma.fill.create({
                data: { orderId: fill.makerOrderId, userId: fill.makerUserId, stockId, price, qty, side: makerSideDb },
            }),
            prisma.order.update({
                where: { id: fill.makerOrderId },
                data: { filledQty: { increment: qty } },
            })
        );
        const makerStatus = statusUpdate(fill.makerOrderId, fill.makerStatus);
        if (makerStatus) ops.push(makerStatus);
    }

    await prisma.$transaction(ops);
}

// ---------------------------------------------------------------------- app

await Promise.all(
    MARKETS.map((market) =>
        prisma.stock.upsert({ where: { symbol: market.symbol }, update: {}, create: market })
    )
);

const app = express();
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());

app.get("/markets", async (_req, res) => {
    const markets = await prisma.stock.findMany({
        select: { id: true, symbol: true, name: true },
        orderBy: { symbol: "asc" },
    });
    res.json({ markets });
});

app.post("/signup", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "username and password are required" });
        return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
        res.status(409).json({ error: "Username already taken" });
        return;
    }

    const user = await prisma.user.create({
        data: { username, password: hashPassword(password) },
        select: { id: true, username: true },
    });

    const token = signToken({ userId: user.id, username: user.username });
    res.status(201).json({ userId: user.id, username: user.username, token });
});

app.post("/signin", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "username and password are required" });
        return;
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.password)) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
    }

    const token = signToken({ userId: user.id, username: user.username });
    res.json({ userId: user.id, username: user.username, token });
});

/*
    Credits a balance (testing on-ramp, there is no real payment flow).
    body = { asset: "USD" | "SOL" | "BTC", amount: number }
*/
app.post("/onramp", authMiddleware, async (req, res) => {
    const { asset = QUOTE_ASSET, amount } = req.body ?? {};
    const validAssets = [QUOTE_ASSET, ...MARKETS.map((m) => m.symbol)];
    if (typeof asset !== "string" || !validAssets.includes(asset)) {
        throw new ValidationError(`asset must be one of ${validAssets.join(", ")}`);
    }

    const engineAmount = toAssetUnits(asset, amount);

    // Persist first so deposits survive engine restarts
    await prisma.deposit.create({
        data: { userId: req.userId!, asset, amount },
    });

    const balances = await sendToEngine<EngineBalances>({
        type: "deposit",
        userId: req.userId!,
        asset,
        amount: engineAmount,
    });
    res.json({ balances: formatBalances(balances) });
});

/*
    body = {
        type:           "market" | "limit",
        price:          number | null,
        qty:            number,
        market_id:      string,
        side:           "buy" | "sell"
    }

    @returns {
        orderId: string,
        status: string,
        filledQty: number,
        averagePrice: number | null,
        fills: { price, qty }[]
    }
*/
app.post("/order", authMiddleware, async (req, res) => {
    const userId = req.userId!;
    const { type, price, qty, market_id, side } = req.body ?? {};

    if (type !== "market" && type !== "limit") throw new ValidationError('type must be "market" or "limit"');
    if (side !== "buy" && side !== "sell") throw new ValidationError('side must be "buy" or "sell"');
    if (typeof market_id !== "string") throw new ValidationError("market_id is required");

    const qtyUnits = toQtyUnits(qty);
    const priceUnits = type === "limit" ? toPriceUnits(price) : null;

    const stock = await prisma.stock.findUnique({ where: { symbol: market_id.toUpperCase() } });
    if (!stock) {
        res.status(404).json({ error: "Market not found" });
        return;
    }

    // Create the row BEFORE the engine sees the order, so fills against it
    // (from other users' requests) always have an order to reference.
    const orderId = crypto.randomUUID();
    await prisma.order.create({
        data: {
            id: orderId,
            userId,
            stockId: stock.id,
            type: type === "market" ? "MARKET" : "LIMIT",
            side: side === "buy" ? "BUY" : "SELL",
            price: priceUnits === null ? null : priceToDb(priceUnits),
            qty: qtyToDb(qtyUnits),
        },
    });

    let result: EngineOrderResult;
    try {
        result = await sendToEngine<EngineOrderResult>({
            type: "create_order",
            orderId,
            userId,
            market: stock.symbol,
            side,
            orderType: type,
            price: priceUnits,
            qty: qtyUnits,
        });
    } catch (err) {
        // Engine rejected it, so it never entered the book.
        if (err instanceof EngineRequestError) {
            await prisma.order.delete({ where: { id: orderId } });
        }
        throw err;
    }

    await persistOrderResult(result, userId, stock.id, side);

    const filledValue = result.fills.reduce((sum, f) => sum + f.price * f.qty, 0);
    res.json({
        message: "order placed",
        orderId,
        status: result.status,
        filledQty: fromQtyUnits(result.filledQty),
        averagePrice: result.filledQty > 0 ? fromPriceUnits(filledValue / result.filledQty) : null,
        fills: result.fills.map((f) => ({ price: fromPriceUnits(f.price), qty: fromQtyUnits(f.qty) })),
    });
});

/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER 
*/
app.get("/order/:orderId", authMiddleware, async (req, res) => {
    const order = await prisma.order.findFirst({
        where: { id: String(req.params.orderId), userId: req.userId! },
        include: { fills: true, stock: { select: { symbol: true, name: true } } },
    });
    if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
    }
    res.json({ order });
});

app.delete("/order/:orderId", authMiddleware, async (req, res) => {
    const orderId = String(req.params.orderId);
    const userId = req.userId!;

    const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
    }

    // The engine is the source of truth: it refuses if already filled/cancelled.
    const result = await sendToEngine<EngineCancelResult>({ type: "cancel_order", orderId, userId });

    const updated = await prisma.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
    });
    res.json({
        message: "order cancelled",
        order: updated,
        filledQty: fromQtyUnits(result.filledQty),
        remainingQty: fromQtyUnits(result.remainingQty),
    });
});

app.get("/depth/:symbol", async (req, res) => {
    const depth = await sendToEngine<EngineDepth>({
        type: "get_depth",
        market: String(req.params.symbol).toUpperCase(),
    });
    res.json({ market: depth.market, bids: formatLevels(depth.bids), asks: formatLevels(depth.asks) });
});

app.get("/trades/:symbol", async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const stock = await prisma.stock.findUnique({ where: { symbol } });
    if (!stock) {
        res.status(404).json({ error: "Market not found" });
        return;
    }

    // Each matched trade inserts one BUY fill and one SELL fill; query BUY side to get unique trades.
    const fills = await prisma.fill.findMany({
        where: { stockId: stock.id, side: "BUY" },
        select: { id: true, price: true, qty: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    res.json({
        market: symbol,
        trades: fills.map((f) => ({
            id: f.id,
            price: Number(f.price),
            qty: Number(f.qty),
            createdAt: f.createdAt,
        })),
    });
});

app.get("/orders", authMiddleware, async (req, res) => {
    const orders = await prisma.order.findMany({
        where: { userId: req.userId! },
        include: { stock: { select: { symbol: true, name: true } } },
        orderBy: { createdAt: "desc" },
    });
    res.json({ orders });
});

app.get("/orders/open", authMiddleware, async (req, res) => {
    const orders = await prisma.order.findMany({
        where: { userId: req.userId!, status: { in: ["OPEN", "PARTIALLY_FILLED"] } },
        include: { stock: { select: { symbol: true, name: true } } },
        orderBy: { createdAt: "desc" },
    });
    res.json({ orders });
});

app.get("/fills", authMiddleware, async (req, res) => {
    const fills = await prisma.fill.findMany({
        where: { userId: req.userId! },
        include: { stock: { select: { symbol: true, name: true } } },
        orderBy: { createdAt: "desc" },
    });
    res.json({ fills });
});

app.get("/balance/usd", authMiddleware, async (req, res) => {
    const balances = await sendToEngine<EngineBalances>({ type: "get_user_balance", userId: req.userId! });
    res.json(formatBalances(balances)[QUOTE_ASSET]);
});

/*  
    Returns the balance of all stocks
*/
app.get("/balance", authMiddleware, async (req, res) => {
    const balances = await sendToEngine<EngineBalances>({ type: "get_user_balance", userId: req.userId! });
    res.json({ balances: formatBalances(balances) });
});

// Express 5 forwards errors thrown in async handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError || err instanceof EngineRequestError) {
        res.status(400).json({ error: err.message });
        return;
    }
    if (err instanceof SyntaxError) {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
    }
    if (err instanceof EngineTimeoutError) {
        res.status(504).json({ error: err.message });
        return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
});

app.listen(3001, () => console.log("Backend listening on :3001"));
