import { createClient } from "redis";

export const QUEUE_ID = crypto.randomUUID();
const RESPONSE_QUEUE = `response-queue-${QUEUE_ID}`;
const INCOMING_QUEUE = "incoming-order";
const ENGINE_TIMEOUT_MS = 10_000;

/** The engine rejected the request (bad input, insufficient balance, ...). */
export class EngineRequestError extends Error {}
/** The engine did not reply in time. */
export class EngineTimeoutError extends Error {}

type EngineResponse =
    | { identifier: string; ok: true; data: unknown }
    | { identifier: string; ok: false; error: string };

const pending = new Map<
    string,
    { resolve: (response: EngineResponse) => void; timer: ReturnType<typeof setTimeout> }
>();

// Separate connections: brPop blocks the connection it runs on.
const publisher = await createClient({ url: process.env.REDIS_URL })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();

const subscriber = await createClient({ url: process.env.REDIS_URL })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();

async function pollQueue() {
    console.log("Listening for engine responses on " + RESPONSE_QUEUE);
    while (true) {
        try {
            const response = await subscriber.brPop(RESPONSE_QUEUE, 5);
            if (!response) continue;

            const parsed = JSON.parse(response.element) as EngineResponse;
            const entry = pending.get(parsed.identifier);
            if (!entry) continue;

            clearTimeout(entry.timer);
            pending.delete(parsed.identifier);
            entry.resolve(parsed);
        } catch (err) {
            console.error("Error while polling engine responses", err);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

void pollQueue();

export function untilWeGotBack(identifier: string): Promise<EngineResponse> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(identifier);
            reject(new EngineTimeoutError("Engine did not respond in time"));
        }, ENGINE_TIMEOUT_MS);
        pending.set(identifier, { resolve, timer });
    });
}

/** Push a message to the engine and wait for its reply. */
export async function sendToEngine<T>(payload: Record<string, unknown>): Promise<T> {
    const identifier = crypto.randomUUID();
    // Register before pushing so a fast reply can't be missed.
    const responsePromise = untilWeGotBack(identifier);

    try {
        await publisher.lPush(
            INCOMING_QUEUE,
            JSON.stringify({ ...payload, identifier, queue_id: QUEUE_ID })
        );
    } catch (err) {
        const entry = pending.get(identifier);
        if (entry) {
            clearTimeout(entry.timer);
            pending.delete(identifier);
        }
        throw err;
    }

    const response = await responsePromise;
    if (!response.ok) throw new EngineRequestError(response.error);
    return response.data as T;
}
