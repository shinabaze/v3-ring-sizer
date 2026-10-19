// Find the input size that earns the most on a route that starts and ends in the same token.
//
// Profit against size has one peak: small trades earn a small spread, big trades eat their own
// price impact. So: double the size until profit falls, refine the peak with a golden-section
// search, then step back a little, because the curve is steep on the far side.
//
// The quote is injected, so this knows nothing about pools. A size the quote refuses is not
// "unprofitable", it is unknown, and every bigger size is unknown too (a bigger swap can only
// need more of the pool), so the search never looks above it.

const PHI = (Math.sqrt(5) - 1) / 2;

/**
 * @param o.quote     (amountIn: bigint) => {amountOut: bigint, exact: boolean, reason}
 * @param o.min       smallest size to try (bigint)
 * @param o.max       largest size allowed (bigint), e.g. what you can borrow
 * @param o.cost      (amountIn) => bigint, in the input token: gas, fees, anything per trade
 * @param o.backoff   final size = best * backoff when that keeps `keep` of the profit
 * @returns {size, profit, amountOut, reason, probes, ceiling}
 */
export function findBestSize({ quote, min, max, cost = () => 0n, backoff = 0.9, keep = 0.95, tolerance = 0.01 }) {
  min = BigInt(min); max = BigInt(max);
  let probes = 0;
  const seen = new Map();
  const evaluate = size => {
    if (size < min) size = min;
    if (size > max) size = max;
    const key = size.toString();
    if (seen.has(key)) return seen.get(key);
    probes++;
    const q = quote(size);
    const r = q.exact
      ? { size, exact: true, amountOut: q.amountOut, profit: q.amountOut - size - cost(size) }
      : { size, exact: false, reason: q.reason };
    seen.set(key, r);
    return r;
  };
  const at = x => evaluate(BigInt(Math.round(x)));
  const better = (a, b) => a && a.exact && (!b || a.profit > b.profit);

  // 1. double until profit falls twice, the quote refuses, or we hit max
  let best = null, ceiling = max, refused = null, falls = 0, lastOk = 0n;
  for (let size = min; ; size *= 2n) {
    const r = evaluate(size > max ? max : size);
    if (!r.exact) { refused = r.reason; ceiling = lastOk; break; }
    lastOk = r.size;
    if (better(r, best)) { best = r; falls = 0; } else if (++falls >= 2) break;
    if (r.size >= max) break;
  }
  if (!best) {
    return { size: 0n, profit: 0n, amountOut: 0n, probes, ceiling: 0n,
      reason: refused ? `cannot quote even the smallest size (${refused})` : 'no size quoted' };
  }

  // 2. golden-section search on [best / 2, best * 4], never above the last size we could quote
  let lo = Math.max(Number(min), Number(best.size) / 2);
  let hi = Math.min(Number(ceiling), Number(best.size) * 4);
  if (hi > lo * (1 + tolerance)) {
    let x1 = hi - (hi - lo) * PHI, x2 = lo + (hi - lo) * PHI;
    let f1 = at(x1), f2 = at(x2);
    while ((hi - lo) / hi > tolerance) {
      const p1 = f1.exact ? f1.profit : null, p2 = f2.exact ? f2.profit : null;
      if (p2 === null || (p1 !== null && p1 >= p2)) {
        hi = x2; x2 = x1; f2 = f1; x1 = hi - (hi - lo) * PHI; f1 = at(x1);
      } else {
        lo = x1; x1 = x2; f1 = f2; x2 = lo + (hi - lo) * PHI; f2 = at(x2);
      }
      for (const f of [f1, f2]) if (better(f, best)) best = f;
    }
  }

  // 3. back off: just past the peak, profit drops fast and a stale price lands you there
  const safe = at(Number(best.size) * backoff);
  const chosen = safe.exact && best.profit > 0n && safe.profit * 100n >= best.profit * BigInt(Math.round(keep * 100))
    ? safe : best;

  if (chosen.profit <= 0n) {
    return { size: 0n, profit: chosen.profit, amountOut: 0n, probes, ceiling, reason: 'no profitable size' };
  }
  return { size: chosen.size, profit: chosen.profit, amountOut: chosen.amountOut, probes, ceiling,
    reason: refused ? `ok, capped below the first size the quote refused (${refused})` : 'ok' };
}
