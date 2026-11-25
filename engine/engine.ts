/**
 * In-memory matching engine (pure logic, no I/O).
 *
 * All amounts are INTEGERS to avoid floating point errors:
 *  - price : smallest price unit (e.g. cents) per 1 whole asset
 *  - qty   : smallest asset unit (e.g. 1e-4 of an asset)
 *  - USD balances are stored in (price unit * qty unit), so `price * qty`
 *    is directly the USD value of a trade.
 * The backend is responsible for converting decimals <-> integer units.
 */

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";

export interface Order {
    orderId: string;
    userId: string;
    market: string;
    side: Side;
    orderType: OrderType;
    price: number | null;
    qty: number;
    filledQty: number;
    status: OrderStatus;
    sequence: number;
}

export interface Fill {
    tradeId: number;
    market: string;
    price: number;
    qty: number;
    takerOrderId: string;
    takerUserId: string;
    takerSide: Side;
    makerOrderId: string;
    makerUserId: string;
    makerFilledQty: number;
    makerStatus: OrderStatus;
}

export interface HydrationState {
    balances: Record<string, Record<string, { available: number; locked: number }>>;
    openOrders: Array<{
        orderId: string;
        userId: string;
        market: string;
        side: Side;
        orderType: OrderType;
        price: number | null;
        qty: number;
        filledQty: number;
    }>;
    lastTradeId: number;
}

export interface Holding {
    available: number;
    locked: number;
}

export type Balances = Record<string, Holding>;

interface OrderBook {
    bids: Order[]; // best (highest) price first, then oldest first
    asks: Order[]; // best (lowest) price first, then oldest first
}

type Message = Record<string, unknown>;

export const QUOTE_ASSET = "USD";

/** Expected, user-facing errors (bad input, insufficient balance, ...). */
export class EngineError extends Error {}

function requireString(msg: Message, field: string): string {
    const value = msg[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new EngineError(`${field} is required`);
    }
    return value;
}

function requirePositiveInt(msg: Message, field: string): number {
    const value = msg[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new EngineError(`${field} must be a positive integer`);
    }
    return value;
}

function aggregateLevels(orders: Order[]): [number, number][] {
    const levels: [number, number][] = [];
    for (const order of orders) {
        const remaining = order.qty - order.filledQty;
        const last = levels[levels.length - 1];
        if (last && last[0] === order.price) {
            last[1] += remaining;
        } else {
            levels.push([order.price!, remaining]);
        }
    }
    return levels;
}

function snapshotOrder(order: Order) {
    const { sequence, ...rest } = order;
    return { ...rest, remainingQty: order.qty - order.filledQty };
}

export class Engine {
    private readonly markets: string[];
    private readonly books: Record<string, OrderBook> = {};
    private readonly balances: Record<string, Balances> = {};
    private readonly orders: Record<string, Order> = {};
    private sequence = 0;
    private tradeSequence = 0;

    constructor(markets: string[]) {
        this.markets = [...markets];
        for (const market of markets) {
            this.books[market] = { bids: [], asks: [] };
        }
    }

    process(message: Message): unknown {
        switch (message.type) {
            case "create_order":
                return this.createOrder(message);
            case "cancel_order":
                return this.cancelOrder(message);
            case "get_depth":
                return this.getDepth(message);
            case "get_user_balance":
                return this.getUserBalance(message);
            case "get_order":
                return this.getOrder(message);
            case "get_open_orders":
                return this.getOpenOrders(message);
            case "deposit":
                return this.deposit(message);
            default:
                throw new EngineError(`Unknown message type: ${String(message.type)}`);
        }
    }

    // ---------------------------------------------------------------- handlers

    private createOrder(msg: Message) {
        const orderId = requireString(msg, "orderId");
        const userId = requireString(msg, "userId");
        const market = this.requireMarket(msg);
        const side = msg.side;
        if (side !== "buy" && side !== "sell") {
            throw new EngineError('side must be "buy" or "sell"');
        }
        const orderType = msg.orderType;
        if (orderType !== "market" && orderType !== "limit") {
            throw new EngineError('orderType must be "market" or "limit"');
        }
        const qty = requirePositiveInt(msg, "qty");
        const price = orderType === "limit" ? requirePositiveInt(msg, "price") : null;
        if (this.orders[orderId]) {
            throw new EngineError("Duplicate orderId");
        }

        const usd = this.holding(userId, QUOTE_ASSET);
        const base = this.holding(userId, market);

        // Lock funds up front. All checks happen before any state is mutated.
        if (side === "buy" && price !== null) {
            const cost = price * qty;
            if (!Number.isSafeInteger(cost)) throw new EngineError("Order value too large");
            if (usd.available < cost) throw new EngineError("Insufficient USD balance");
            usd.available -= cost;
            usd.locked += cost;
        } else if (side === "sell") {
            if (base.available < qty) throw new EngineError(`Insufficient ${market} balance`);
            base.available -= qty;
            base.locked += qty;
        } else if (usd.available <= 0) {
            // Market buy: cost is unknown, USD is debited per fill during matching.
            throw new EngineError("Insufficient USD balance");
        }

        const order: Order = {
            orderId,
            userId,
            market,
            side,
            orderType,
            price,
            qty,
            filledQty: 0,
            status: "OPEN",
            sequence: ++this.sequence,
        };
        this.orders[orderId] = order;

        const book = this.books[market]!;
        const fills = this.match(order, book);
        const remaining = order.qty - order.filledQty;

        if (remaining === 0) {
            order.status = "FILLED";
        } else if (orderType === "limit") {
            order.status = order.filledQty > 0 ? "PARTIALLY_FILLED" : "OPEN";
            this.insert(book, order);
        } else {
            // Market orders are immediate-or-cancel: release whatever didn't fill.
            if (side === "sell") {
                base.locked -= remaining;
                base.available += remaining;
            }
            order.status = "CANCELLED";
        }

        return { orderId, status: order.status, filledQty: order.filledQty, fills };
    }

    private cancelOrder(msg: Message) {
        const orderId = requireString(msg, "orderId");
        const userId = requireString(msg, "userId");
        const order = this.orders[orderId];
        if (!order || order.userId !== userId) throw new EngineError("Order not found");
        if (order.status === "FILLED" || order.status === "CANCELLED") {
            throw new EngineError(`Order is already ${order.status.toLowerCase()}`);
        }

        const book = this.books[order.market]!;
        const levels = order.side === "buy" ? book.bids : book.asks;
        const index = levels.indexOf(order);
        if (index !== -1) levels.splice(index, 1);

        const remaining = order.qty - order.filledQty;
        if (order.side === "buy") {
            const reserved = order.price! * remaining;
            const usd = this.holding(userId, QUOTE_ASSET);
            usd.locked -= reserved;
            usd.available += reserved;
        } else {
            const base = this.holding(userId, order.market);
            base.locked -= remaining;
            base.available += remaining;
        }
        order.status = "CANCELLED";

        return { orderId, status: order.status, filledQty: order.filledQty, remainingQty: remaining };
    }

    private getDepth(msg: Message) {
        const market = this.requireMarket(msg);
        const book = this.books[market]!;
        return { market, bids: aggregateLevels(book.bids), asks: aggregateLevels(book.asks) };
    }

    private getUserBalance(msg: Message): Balances {
        return this.copyBalances(requireString(msg, "userId"));
    }

    private getOrder(msg: Message) {
        const orderId = requireString(msg, "orderId");
        const userId = requireString(msg, "userId");
        const order = this.orders[orderId];
        if (!order || order.userId !== userId) throw new EngineError("Order not found");
        return snapshotOrder(order);
    }

    private getOpenOrders(msg: Message) {
        const userId = requireString(msg, "userId");
        const market = typeof msg.market === "string" ? msg.market : null;
        return Object.values(this.orders)
            .filter(
                (o) =>
                    o.userId === userId &&
                    (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") &&
                    (market === null || o.market === market)
            )
            .map(snapshotOrder);
    }

    /** Test/on-ramp helper: credit a user's balance. */
    private deposit(msg: Message): Balances {
        const userId = requireString(msg, "userId");
        const asset = requireString(msg, "asset");
        const amount = requirePositiveInt(msg, "amount");
        const holding = this.holding(userId, asset);
        if (!Number.isSafeInteger(holding.available + amount)) {
            throw new EngineError("Balance too large");
        }
        holding.available += amount;
        return this.copyBalances(userId);
    }

    // ----------------------------------------------------------------- matching

    private match(taker: Order, book: OrderBook): Fill[] {
        const fills: Fill[] = [];
        const resting = taker.side === "buy" ? book.asks : book.bids;

        while (resting.length > 0 && taker.filledQty < taker.qty) {
            const maker = resting[0]!;
            const price = maker.price!; // trades execute at the maker's price

            if (taker.price !== null) {
                const crosses = taker.side === "buy" ? price <= taker.price : price >= taker.price;
                if (!crosses) break;
            }

            let qty = Math.min(taker.qty - taker.filledQty, maker.qty - maker.filledQty);
            if (taker.side === "buy" && taker.price === null) {
                const affordable = Math.floor(this.holding(taker.userId, QUOTE_ASSET).available / price);
                qty = Math.min(qty, affordable);
                if (qty <= 0) break;
            }

            this.settle(taker, maker, price, qty);
            taker.filledQty += qty;
            maker.filledQty += qty;

            if (maker.filledQty === maker.qty) {
                maker.status = "FILLED";
                resting.shift();
            } else {
                maker.status = "PARTIALLY_FILLED";
            }

            fills.push({
                tradeId: ++this.tradeSequence,
                market: taker.market,
                price,
                qty,
                takerOrderId: taker.orderId,
                takerUserId: taker.userId,
                takerSide: taker.side,
                makerOrderId: maker.orderId,
                makerUserId: maker.userId,
                makerFilledQty: maker.filledQty,
                makerStatus: maker.status,
            });
        }

        return fills;
    }

    private settle(taker: Order, maker: Order, price: number, qty: number) {
        const buyer = taker.side === "buy" ? taker : maker;
        const seller = taker.side === "buy" ? maker : taker;
        const quote = price * qty;

        const buyerUsd = this.holding(buyer.userId, QUOTE_ASSET);
        const buyerBase = this.holding(buyer.userId, buyer.market);
        const sellerUsd = this.holding(seller.userId, QUOTE_ASSET);
        const sellerBase = this.holding(seller.userId, seller.market);

        if (buyer.price === null) {
            // market buy: pay directly from available
            buyerUsd.available -= quote;
        } else {
            // limit buy: release what was reserved at the limit price, refund any price improvement
            const reserved = buyer.price * qty;
            buyerUsd.locked -= reserved;
            buyerUsd.available += reserved - quote;
        }
        buyerBase.available += qty;

        sellerBase.locked -= qty;
        sellerUsd.available += quote;
    }

    private insert(book: OrderBook, order: Order) {
        const levels = order.side === "buy" ? book.bids : book.asks;
        const price = order.price!;
        // Insert after every order with an equal-or-better price (price-time priority).
        let index = levels.findIndex((o) => (order.side === "buy" ? o.price! < price : o.price! > price));
        if (index === -1) index = levels.length;
        levels.splice(index, 0, order);
    }

    // ------------------------------------------------------------------ helpers

    private requireMarket(msg: Message): string {
        const market = requireString(msg, "market");
        if (!this.books[market]) throw new EngineError(`Unknown market: ${market}`);
        return market;
    }

    private holdings(userId: string): Balances {
        let holdings = this.balances[userId];
        if (!holdings) {
            holdings = { [QUOTE_ASSET]: { available: 0, locked: 0 } };
            for (const market of this.markets) {
                holdings[market] = { available: 0, locked: 0 };
            }
            this.balances[userId] = holdings;
        }
        return holdings;
    }

    private holding(userId: string, asset: string): Holding {
        const holding = this.holdings(userId)[asset];
        if (!holding) throw new EngineError(`Unknown asset: ${asset}`);
        return holding;
    }

    private copyBalances(userId: string): Balances {
        return Object.fromEntries(
            Object.entries(this.holdings(userId)).map(([asset, h]) => [asset, { ...h }])
        );
    }

    // ------------------------------------------------------------ hydration

    /**
     * Rebuild in-memory state from persisted data (called once on startup).
     * `balances` must already include locked amounts for open orders.
     * `openOrders` must be sorted by createdAt (oldest first) so time
     * priority in the book is preserved.
     */
    hydrate(state: HydrationState): void {
        for (const [userId, assets] of Object.entries(state.balances)) {
            for (const [asset, h] of Object.entries(assets)) {
                const holding = this.holding(userId, asset);
                holding.available = h.available;
                holding.locked = h.locked;
            }
        }

        for (const o of state.openOrders) {
            const order: Order = {
                orderId: o.orderId,
                userId: o.userId,
                market: o.market,
                side: o.side,
                orderType: o.orderType,
                price: o.price,
                qty: o.qty,
                filledQty: o.filledQty,
                status: o.filledQty > 0 ? "PARTIALLY_FILLED" : "OPEN",
                sequence: ++this.sequence,
            };
            this.orders[order.orderId] = order;
            this.insert(this.books[order.market]!, order);
        }

        // Ensure future trade IDs don't collide with historical ones.
        this.tradeSequence = Math.max(this.tradeSequence, state.lastTradeId);
        console.log(
            `Hydrated: ${Object.keys(state.balances).length} users, ` +
            `${state.openOrders.length} open orders`
        );
    }
}
