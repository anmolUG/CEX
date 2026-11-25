import "dotenv/config";
import { createClient } from "redis";
import { Engine, EngineError } from "./engine";
import { loadStateFromDb } from "./hydrate";

const MARKETS = ["SOL", "BTC"];
const INCOMING_QUEUE = "incoming-order";
const BRPOP_TIMEOUT = 30; // seconds; avoids infinite idle on Upstash free tier

// ---------------------------------------------------------------- hydrate

const databaseUrl = process.env.DATABASE_URL;
const engine = new Engine(MARKETS);

if (databaseUrl) {
    console.log("Hydrating engine state from Postgres…");
    const state = await loadStateFromDb(databaseUrl, MARKETS);
    engine.hydrate(state);
} else {
    console.warn("DATABASE_URL not set — starting with empty state (no crash recovery)");
}

// ---------------------------------------------------------------- redis

const consumer = await createClient({ url: process.env.REDIS_URL })
  .on("error", (err) => console.log("Redis consumer error", err))
  .connect();

const publisher = await createClient({ url: process.env.REDIS_URL })
  .on("error", (err) => console.log("Redis publisher error", err))
  .connect();

console.log(`Engine started for markets: ${MARKETS.join(", ")}`);

// ----------------------------------------------------------- main loop

while (true) {
  let response;
  try {
    response = await consumer.brPop(INCOMING_QUEUE, BRPOP_TIMEOUT);
  } catch (err) {
    // Connection dropped — node-redis reconnects automatically,
    // just log and retry on the next iteration.
    console.error("brPop error (will retry):", err);
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }

  if (!response) continue; // timeout, no message

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(response.element);
  } catch {
    console.error("Dropping malformed message:", response.element);
    continue;
  }

  let reply;
  try {
    reply = { identifier: message.identifier, ok: true, data: engine.process(message) };
  } catch (err) {
    if (err instanceof EngineError) {
      reply = { identifier: message.identifier, ok: false, error: err.message };
    } else {
      console.error("Unexpected engine error", err);
      reply = { identifier: message.identifier, ok: false, error: "Internal engine error" };
    }
  }

  if (message.queue_id) {
    try {
      await publisher.lPush(`response-queue-${message.queue_id}`, JSON.stringify(reply));
    } catch (err) {
      console.error("Failed to publish reply:", err);
    }
  }
}
