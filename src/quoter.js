// Quote an exact-input swap through a concentrated-liquidity pool (Uniswap V3 style, and Algebra
// pools, which use the same tick math), or refuse.
//
// A pool snapshot only describes the ticks someone fetched. Past that range the liquidity is
// unknown, so a quote that needs it is not a quote. Instead of guessing, quoteSwap returns
// exact: false and the reason, and the caller drops that size.

import { Q96, MIN_TICK, MAX_TICK, sqrtPriceAtTick } from './tickmath.js';

const FEE_DENOM = 1_000_000n;

const divUp = (a, b) => (a + b - 1n) / b;

// token0 between two prices (lo < hi)
function amount0Delta(sqrtLo, sqrtHi, L, roundUp) {
  const num = (L << 96n) * (sqrtHi - sqrtLo);
  return roundUp ? divUp(divUp(num, sqrtHi), sqrtLo) : num / sqrtHi / sqrtLo;
}

// token1 between two prices (lo < hi)
function amount1Delta(sqrtLo, sqrtHi, L, roundUp) {
  const num = L * (sqrtHi - sqrtLo);
  return roundUp ? divUp(num, Q96) : num / Q96;
}

// One step: move from sqrtP toward sqrtTarget with liquidity L, spending at most `remaining`.
// Inputs round up and outputs round down, so the quote never favours the trader.
function step(sqrtP, sqrtTarget, L, remaining, zeroForOne) {
  if (zeroForOne) {
    const maxIn = amount0Delta(sqrtTarget, sqrtP, L, true);
    if (remaining >= maxIn) {
      return { sqrtP: sqrtTarget, used: maxIn, out: amount1Delta(sqrtTarget, sqrtP, L, false), reached: true };
    }
    const n = L << 96n;
    const next = divUp(n * sqrtP, n + remaining * sqrtP);
    return { sqrtP: next, used: remaining, out: amount1Delta(next, sqrtP, L, false), reached: false };
  }
  const maxIn = amount1Delta(sqrtP, sqrtTarget, L, true);
  if (remaining >= maxIn) {
    return { sqrtP: sqrtTarget, used: maxIn, out: amount0Delta(sqrtP, sqrtTarget, L, false), reached: true };
  }
  const next = sqrtP + (remaining << 96n) / L;
  return { sqrtP: next, used: remaining, out: amount0Delta(sqrtP, next, L, false), reached: false };
}

// The tick range the snapshot vouches for. With no tick list, only the current spacing is known:
// inside it liquidity is constant, and that is all single-range math can prove.
function knownRange(pool) {
  if (pool.known) return pool.known;
  if (pool.ticks && pool.ticks.length) {
    throw new Error('pool.ticks needs pool.known = {lower, upper}: the tick range the list covers');
  }
  const lower = Math.floor(pool.tick / pool.tickSpacing) * pool.tickSpacing;
  return { lower, upper: lower + pool.tickSpacing };
}

// The tick that contains a price (the largest t with sqrtPriceAtTick(t) <= sqrtP).
function tickOf(sqrtP, guess) {
  let t = guess;
  while (t > MIN_TICK && sqrtPriceAtTick(t) > sqrtP) t--;
  while (t < MAX_TICK && sqrtPriceAtTick(t + 1) <= sqrtP) t++;
  return t;
}

const refuse = reason => ({ amountOut: 0n, exact: false, reason, sqrtPriceX96: null, tick: null, liquidity: null });

/**
 * @param pool {sqrtPriceX96, tick, liquidity, fee, tickSpacing, ticks?, known?}
 *   fee in millionths (3000 = 0.3%). ticks = [{index, liquidityNet}] for every initialised tick
 *   inside known = {lower, upper}, the tick range that was scanned.
 * @returns {amountOut, exact, reason, sqrtPriceX96, tick, liquidity}; the last three are the
 *   pool's state after the swap.
 */
export function quoteSwap(pool, amountIn, zeroForOne) {
  amountIn = BigInt(amountIn);
  if (amountIn <= 0n) return refuse('bad_input');
  const known = knownRange(pool);
  if (pool.tick < known.lower || pool.tick >= known.upper) return refuse('price_outside_known_ticks');

  const ticks = [...(pool.ticks || [])].sort((a, b) => a.index - b.index);
  let sqrtP = BigInt(pool.sqrtPriceX96);
  let L = BigInt(pool.liquidity);
  let tick = pool.tick;
  let remaining = (amountIn * (FEE_DENOM - BigInt(pool.fee))) / FEE_DENOM;
  let out = 0n;

  while (remaining > 0n) {
    // the next initialised tick in the swap's direction, or the edge of what we know
    const t = zeroForOne
      ? ticks.findLast(x => x.index <= tick && x.index >= known.lower)
      : ticks.find(x => x.index > tick && x.index <= known.upper);
    const next = t ? t.index : zeroForOne ? Math.max(known.lower, MIN_TICK) : Math.min(known.upper, MAX_TICK);

    const s = step(sqrtP, sqrtPriceAtTick(next), L, remaining, zeroForOne);
    sqrtP = s.sqrtP;
    remaining -= s.used;
    out += s.out;

    if (!s.reached) { tick = tickOf(sqrtP, tick); break; }
    tick = zeroForOne ? next - 1 : next;
    if (!t) {
      // at the edge of the scanned range with input left: the rest would be priced on a guess
      if (remaining > 0n) return refuse('past_known_ticks');
      break;
    }
    L = zeroForOne ? L - BigInt(t.liquidityNet) : L + BigInt(t.liquidityNet);
    if (L < 0n) return refuse('bad_tick_data');
  }

  return { amountOut: out, exact: true, reason: 'ok', sqrtPriceX96: sqrtP, tick, liquidity: L };
}

/**
 * Quote a route hop by hop. hops = [{pool, tokenIn}], where each pool names token0 and token1.
 * One refused hop refuses the whole route: a route total built on a guess is not a quote.
 */
export function quotePath(hops, amountIn) {
  let amount = BigInt(amountIn);
  for (let i = 0; i < hops.length; i++) {
    const { pool, tokenIn } = hops[i];
    const r = quoteSwap(pool, amount, tokenIn === pool.token0);
    if (!r.exact) return { amountOut: 0n, exact: false, reason: r.reason, hop: i };
    amount = r.amountOut;
    if (amount === 0n) return { amountOut: 0n, exact: true, reason: 'dust', hop: i };
  }
  return { amountOut: amount, exact: true, reason: 'ok', hop: null };
}
