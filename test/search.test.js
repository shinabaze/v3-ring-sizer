import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBestSize } from '../src/search.js';
import { quotePath } from '../src/quoter.js';
import { toUnits, fromUnits } from '../src/pools.js';
import { ring } from './helpers.js';

// brute force: the best profit over 3000 log-spaced sizes the quote accepts
function brute(quote, cost, maxUnits) {
  let best = -Infinity;
  for (let i = 0; i <= 3000; i++) {
    const x = 10 ** ((i / 3000) * Math.log10(maxUnits));
    const q = quote(toUnits(x));
    if (!q.exact) break;
    best = Math.max(best, fromUnits(q.amountOut) - x - fromUnits(cost(toUnits(x))));
  }
  return best;
}

// a made-up quote: profit = a*x - x^2/d, refused above `limit` units
const fake = ({ a = 0.01, d = 100000, limit = Infinity } = {}) => amountIn => {
  const x = fromUnits(amountIn);
  if (x > limit) return { amountOut: 0n, exact: false, reason: 'past_known_ticks' };
  return { amountOut: toUnits(x + a * x - (x * x) / d), exact: true, reason: 'ok' };
};

test('gets within 2% of the brute-force best on a ring', () => {
  const r = ring();
  const quote = a => quotePath(r, a);
  const cost = () => toUnits(0.5);
  const res = findBestSize({ quote, min: toUnits(1), max: toUnits(1e6), cost });
  const best = brute(quote, cost, 1e6);
  assert.equal(res.reason, 'ok');
  assert.ok(fromUnits(res.profit) >= best * 0.98, `${fromUnits(res.profit)} vs ${best}`);
  assert.ok(res.probes < 40, `${res.probes} probes`);
});

test('never returns a size above the first one the quote refused', () => {
  // the unconstrained peak is at 500 units; quotes stop at 300
  const res = findBestSize({ quote: fake({ limit: 300 }), min: toUnits(1), max: toUnits(1e6) });
  assert.ok(res.size <= toUnits(256), `size ${fromUnits(res.size)}`);
  assert.equal(res.ceiling, toUnits(256));
  assert.match(res.reason, /capped below/);
});

test('finds the peak of a smooth curve and backs off from it', () => {
  const res = findBestSize({ quote: fake(), min: toUnits(1), max: toUnits(1e6) });
  // peak 500, profit 2.5; backing off to 450 keeps 2.475 (99%)
  assert.ok(Math.abs(fromUnits(res.size) - 450) < 10, `size ${fromUnits(res.size)}`);
  assert.ok(fromUnits(res.profit) > 2.45);
});

test('does not back off when that would cost too much profit', () => {
  const res = findBestSize({ quote: fake(), min: toUnits(1), max: toUnits(1e6), backoff: 0.5 });
  assert.ok(Math.abs(fromUnits(res.size) - 500) < 10, `size ${fromUnits(res.size)}`);
});

test('a per-trade cost bigger than the best profit means no trade', () => {
  const res = findBestSize({ quote: fake(), min: toUnits(1), max: toUnits(1e6), cost: () => toUnits(3) });
  assert.equal(res.size, 0n);
  assert.equal(res.reason, 'no profitable size');
});

test('a quote that refuses the smallest size says so', () => {
  const res = findBestSize({ quote: fake({ limit: 0.5 }), min: toUnits(1), max: toUnits(1e6) });
  assert.equal(res.size, 0n);
  assert.match(res.reason, /cannot quote even the smallest size/);
});

test('respects max', () => {
  const res = findBestSize({ quote: fake(), min: toUnits(1), max: toUnits(100) });
  assert.ok(res.size <= toUnits(100));
  assert.ok(res.size >= toUnits(90));
});
