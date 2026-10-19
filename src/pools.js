// Build pool snapshots from liquidity positions, the way a real pool is built: each position adds
// its liquidity at its lower tick and removes it at its upper tick. Used by the tests, the demo
// and the bench. Every token here has 18 decimals, so a raw price equals the human price.

import { Q96, sqrtPriceAtTick } from './tickmath.js';

const ONE = 10n ** 18n;

export const toUnits = x => (BigInt(Math.round(x * 1e6)) * ONE) / 1_000_000n;
export const fromUnits = n => Number(n) / 1e18;

/**
 * @param o.price      token1 per token0
 * @param o.positions  [{lower, upper, liquidity}] with ticks on multiples of tickSpacing
 * @param o.scanned    optional {lower, upper}: pretend only this tick range was fetched
 */
export function makePool({ token0, token1, price, fee = 3000, tickSpacing = 60, positions, scanned }) {
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  // put the price halfway through its tick, so no test starts exactly on a boundary
  const a = sqrtPriceAtTick(tick), b = sqrtPriceAtTick(tick + 1);
  const sqrtPriceX96 = a + (b - a) / 2n;

  const net = new Map();
  let liquidity = 0n;
  for (const p of positions) {
    if (p.lower % tickSpacing || p.upper % tickSpacing || p.lower >= p.upper) {
      throw new Error(`position ${p.lower}..${p.upper} is not on spacing ${tickSpacing}`);
    }
    const L = BigInt(p.liquidity);
    net.set(p.lower, (net.get(p.lower) || 0n) + L);
    net.set(p.upper, (net.get(p.upper) || 0n) - L);
    if (p.lower <= tick && tick < p.upper) liquidity += L;
  }

  const all = [...net].filter(([, n]) => n !== 0n).map(([index, liquidityNet]) => ({ index, liquidityNet }));
  const known = scanned || {
    lower: Math.min(...positions.map(p => p.lower)),
    upper: Math.max(...positions.map(p => p.upper)),
  };
  const ticks = all.filter(t => t.index >= known.lower && t.index <= known.upper);
  return { token0, token1, fee, tickSpacing, tick, sqrtPriceX96, liquidity, ticks, known };
}

// Virtual reserves of the active range: inside it the pool behaves like x * y = k.
export function virtualReserves(pool) {
  const L = BigInt(pool.liquidity), s = BigInt(pool.sqrtPriceX96);
  return { reserve0: (L * Q96) / s, reserve1: (L * s) / Q96 };
}

// Liquidity for a range that holds about `amount1` of token1 at the current price.
export function liquidityFor(price, amount1) {
  return BigInt(Math.round(amount1 / Math.sqrt(price))) * ONE;
}
