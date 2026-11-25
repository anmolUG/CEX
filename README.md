# Cove — Centralized Spot Exchange (CEX)

**Cove** is a full-stack centralized spot exchange built with a decoupled **single-threaded in-memory matching engine**, **Redis message queues**, **PostgreSQL (Prisma)** persistence with **crash-recovery hydration**, and a dark-mode **React + Tailwind** trading terminal.

---

## Architecture

```text
  Browser — Cove Trading UI (frontend :5173)
       │  HTTP / REST (JSON + JWT)
       ▼
┌──────────────────────────────────────────────────────────┐
│  Backend API Gateway (backend :3001)                     │
│  - Auth (/signup, /signin, scrypt + HS256 JWT)           │
│  - Input validation & decimal <-> integer unit scaling   │
│  - Unique QUEUE_ID + per-request `identifier` bridge     │
└──┬──────────────────────────┬─────────────────────▲──────┘
   │                          │                     │
   │ Users, Deposits,         │ LPUSH               │ BRPOP
   │ Orders, Fills (ACID)     │ "incoming-order"    │ "response-queue-<QUEUE_ID>"
   ▼                          ▼                     │
┌──────────────┐      ┌─────────────────────────────┴──────┐
│  PostgreSQL  │      │           Redis (Queues)           │
│  (Prisma)    │      └───────┬─────────────────────▲──────┘
└──────────────┘              │ BRPOP               │ LPUSH
       │                      │ "incoming-order"    │ "response-queue-<QUEUE_ID>"
       │ Startup hydration    ▼                     │
       │ (deposits, fills,  ┌───────────────────────┴────────────┐
       │  open orders)      │  Matching Engine (engine/index.ts) │
       └───────────────────►│  - Single-threaded sequential loop │
                            │  - In-memory Orderbooks & Balances │
                            │  - Price-time priority matching    │
                            │  - Integer-only accounting         │
                            └────────────────────────────────────┘
```

### Why This Architecture?
- **Lock-free order matching:** Only one single-threaded `engine` mutates live orderbooks and balances in memory, eliminating race conditions, double-spends, and database row locks during matching.
- **Horizontally scalable API:** Each `backend` instance registers its own `response-queue-<QUEUE_ID>` in Redis (`backend/untilWeGotBack.ts`), allowing multiple stateless API instances to share one matching engine.
- **Exact integer math:** The engine operates strictly on scaled integers (`price * 10^2`, `qty * 10^4`, `USD * 10^6`) to avoid floating-point rounding bugs.
- **Crash recovery via DB hydration:** On startup, `engine/hydrate.ts` loads all deposits, executed fills, and `OPEN`/`PARTIALLY_FILLED` orders (ordered by `createdAt`) from PostgreSQL to reconstruct exact available/locked balances and orderbook time priority.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Matching Engine** | TypeScript, Node/Bun, `redis` (`BRPOP`/`LPUSH`), `pg` |
| **Backend API** | Express 5, TypeScript, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL, Redis |
| **Frontend UI** | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide Icons |

---

## Project Structure

```text
CEX/
├── engine/
│   ├── engine.ts          # Pure in-memory orderbook & matching logic
│   ├── hydrate.ts         # Startup state reconstruction from PostgreSQL
│   ├── index.ts           # Redis BRPOP worker loop
│   └── engine.test.ts     # Unit tests (matching, priority, conservation of funds)
├── backend/
│   ├── prisma/schema.prisma # User, Stock, Deposit, Order, Fill models
│   ├── auth.ts            # scrypt password hashing & HS256 JWT middleware
│   ├── db.ts              # Prisma + pg Pool client
│   ├── units.ts           # Decimal <-> integer unit conversions
│   ├── untilWeGotBack.ts  # Redis request-response Promise bridge
│   ├── index.ts           # Express REST API routes
│   ├── seed.ts            # 3-account market-maker seeder (SOL & BTC)
│   ├── test.e2e.ts        # End-to-end API test suite
│   └── test.recovery.ts   # Engine restart / hydration verification test
└── frontend/
    └── src/
        ├── api.ts         # Typed API client
        ├── context/       # Auth & live balance context
        ├── components/    # Navbar, DepositModal, PriceChart
        └── pages/         # MarketsPage, TradePage, PortfolioPage, AuthPage
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/signup` | Public | Register a new account and receive a JWT |
| `POST` | `/signin` | Public | Sign in and receive a JWT |
| `GET` | `/markets` | Public | List tradable spot markets (`SOL`, `BTC`) |
| `GET` | `/depth/:symbol` | Public | Live aggregated orderbook bids & asks |
| `GET` | `/trades/:symbol` | Public | Recent executed trades for a market |
| `POST` | `/onramp` | JWT | Deposit test funds (`USD`, `SOL`, `BTC`) |
| `POST` | `/order` | JWT | Place a `limit` or `market` buy/sell order |
| `GET` | `/order/:orderId` | JWT | Get order status and individual fills |
| `DELETE` | `/order/:orderId` | JWT | Cancel an open order and unlock funds |
| `GET` | `/orders` | JWT | User's full order history |
| `GET` | `/orders/open` | JWT | User's currently open / partially filled orders |
| `GET` | `/fills` | JWT | User's trade fill history |
| `GET` | `/balance` | JWT | Available & locked balances across all assets |
| `GET` | `/balance/usd` | JWT | Available & locked USD balance |

---

## Getting Started

### 1. Prerequisites
- **Node.js 22+** (or **Bun**)
- **PostgreSQL** database (local or hosted, e.g. Aiven / Neon / Supabase)
- **Redis** instance (local or hosted, e.g. Upstash via `rediss://`)

### 2. Configure Environment Variables

Copy the templates and fill in your credentials:

```bash
cp backend/.env.example backend/.env
cp engine/.env.example engine/.env
```

- `backend/.env`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`
- `engine/.env`: `DATABASE_URL`, `REDIS_URL`

*(If using Aiven Postgres with `pg`, include `uselibpqcompat=true&sslmode=require` in `DATABASE_URL`.)*

### 3. Install Dependencies & Sync Database

```bash
cd engine && npm install
cd ../backend && npm install && npx prisma generate && npx prisma db push
cd ../frontend && npm install
```

### 4. Run All Services

Open 3 terminals:

```bash
# Terminal 1 — Matching Engine
cd engine
npm start

# Terminal 2 — Backend API (http://localhost:3001)
cd backend
npm start

# Terminal 3 — Cove Frontend (http://localhost:5173)
cd frontend
npm run dev
```

### 5. Seed the Orderbook (Optional)

Creates 3 market-maker accounts (`mm_alpha`, `mm_beta`, `mm_gamma`), executes sample trades for the chart, and populates ~108 resting orders across `SOL/USD` and `BTC/USD`:

```bash
cd backend
npm run seed
```

---

## Running Tests

```bash
# Matching engine unit tests
cd engine
npm test

# End-to-end backend tests (requires engine & backend running)
cd backend
npm run test:e2e

# Type-checking & frontend production build
cd engine && npm run typecheck
cd ../backend && npm run typecheck
cd ../frontend && npm run build
```
