/**
 * Conversion between API decimals and the engine's integer units.
 *  - price: 2 decimals (cents)
 *  - qty:   4 decimals
 *  - USD balances: price unit * qty unit = 6 decimals
 */
export const PRICE_DECIMALS = 2;
export const QTY_DECIMALS = 4;
export const USD_DECIMALS = PRICE_DECIMALS + QTY_DECIMALS;

export const PRICE_SCALE = 10 ** PRICE_DECIMALS;
export const QTY_SCALE = 10 ** QTY_DECIMALS;
export const USD_SCALE = 10 ** USD_DECIMALS;

export const QUOTE_ASSET = "USD";

/** Invalid client input -> HTTP 400. */
export class ValidationError extends Error {}

function toUnits(value: unknown, decimals: number, field: string): number {
    const num = typeof value === "string" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num) || num <= 0) {
        throw new ValidationError(`${field} must be a positive number`);
    }
    const scale = 10 ** decimals;
    const units = Math.round(num * scale);
    if (Math.abs(units - num * scale) > 1e-6) {
        throw new ValidationError(`${field} supports at most ${decimals} decimal places`);
    }
    if (!Number.isSafeInteger(units)) {
        throw new ValidationError(`${field} is too large`);
    }
    return units;
}

export const toPriceUnits = (value: unknown, field = "price") => toUnits(value, PRICE_DECIMALS, field);
export const toQtyUnits = (value: unknown, field = "qty") => toUnits(value, QTY_DECIMALS, field);

export const fromPriceUnits = (units: number) => units / PRICE_SCALE;
export const fromQtyUnits = (units: number) => units / QTY_SCALE;

/** Decimal strings for Prisma `Decimal` columns. */
export const priceToDb = (units: number) => fromPriceUnits(units).toFixed(PRICE_DECIMALS);
export const qtyToDb = (units: number) => fromQtyUnits(units).toFixed(QTY_DECIMALS);

export function toAssetUnits(asset: string, value: unknown, field = "amount"): number {
    return toUnits(value, asset === QUOTE_ASSET ? USD_DECIMALS : QTY_DECIMALS, field);
}

export function fromAssetUnits(asset: string, units: number): number {
    return units / (asset === QUOTE_ASSET ? USD_SCALE : QTY_SCALE);
}
