import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteSwap, quotePath } from '../src/quoter.js';
import { makePool, virtualReserves, liquidityFor, toUnits, fromUnits } from '../src/pools.js';
import { positions, ring } from './helpers.js';

const pool = () => makePool({ token0: 'A', token1: 'B', price: 2, fee: 3000, tickSpacing: 60, positions: positions(2, 50000, 60) });

test('inside one range a pool is x * y = k on its virtual reserves', () => {
  const p = pool();
  const { reserve0, reserve1 } = virtualReserves(p);
  const x = fromUnits(reserve0), y = fromUnits(reserve1);
  const dx = 10 * (1 - 0.003);
  const r = quoteSwap(p, toUnits(10), true);
  assert.ok(r.exact);
  assert.ok(Math.abs(fromUnits(r.amountOut) / (y - (x * y) / (x + dx)) - 1) < 1e-9);
  const dy = 10 * (1 - 0.003);
  const r2 = quoteSwap(p, toUnits(10), false);
  assert.ok(Math.abs(fromUnits(r2.amountOut) / (x - (x * y) / (y + dy)) - 1) < 1e-9);
});

test('one big swap equals two smaller ones, even across ticks', () => {
  for (const zeroForOne of [true, false]) {
    const p = pool();
    const whole = quoteSwap(p, toUnits(6000), zeroForOne);
    const first = quoteSwap(p, toUnits(2000), zeroForOne);
    const after = { ...p, sqrtPriceX96: first.sqrtPriceX96, tick: first.tick, liquidity: first.liquidity };
    const second = quoteSwap(after, toUnits(4000), zeroForOne);
    assert.ok(whole.exact && first.exact && second.exact);
    assert.notEqual(whole.liquidity, p.liquidity, 'the big swap should have crossed a tick');
    const diff = whole.amountOut - (first.amountOut + second.amountOut);
    assert.ok(diff >= -(10n ** 6n) && diff <= 10n ** 6n, `off by ${diff} wei`);
  }
});

test('crossing a tick changes the liquidity by exactly its liquidityNet', () => {
  const p = pool();
  const r = quoteSwap(p, toUnits(6000), true);
  const inner = liquidityFor(2, 150000);
  assert.equal(r.liquidity, p.liquidity - inner);
});

test('refuses instead of guessing past the scanned ticks', () => {
  const full = pool();
  const narrow = makePool({ token0: 'A', token1: 'B', price: 2, fee: 3000, tickSpacing: 60,
    positions: positions(2, 50000, 60), scanned: { lower: full.tick - 300, upper: full.tick + 300 } });
  const big = toUnits(3000);
  assert.ok(quoteSwap(full, big, true).exact);
  const r = quoteSwap(narrow, big, true);
  assert.equal(r.exact, false);
  assert.equal(r.reason, 'past_known_ticks');
  assert.equal(r.amountOut, 0n);
  // a size that stays inside the scan is still quoted, and matches the full pool
  assert.equal(quoteSwap(narrow, toUnits(10), true).amountOut, quoteSwap(full, toUnits(10), true).amountOut);
});

test('with no tick list only the current spacing can be quoted', () => {
  const { ticks, known, ...bare } = pool();
  assert.ok(quoteSwap(bare, toUnits(1), true).exact);
  const r = quoteSwap(bare, toUnits(3000), true);
  assert.equal(r.exact, false);
  assert.equal(r.reason, 'past_known_ticks');
});

test('running out of positions is a refusal, not a free price', () => {
  const p = makePool({ token0: 'A', token1: 'B', price: 2, fee: 3000, tickSpacing: 60,
    positions: [{ lower: 6900, upper: 7020, liquidity: liquidityFor(2, 100) }] });
  assert.equal(quoteSwap(p, toUnits(1000), true).reason, 'past_known_ticks');
});

test('a tick list without its range is an error', () => {
  const p = pool();
  delete p.known;
  assert.throws(() => quoteSwap(p, toUnits(1), true), /pool.known/);
});

test('bad inputs are refused', () => {
  assert.equal(quoteSwap(pool(), 0n, true).reason, 'bad_input');
});

test('one refused hop refuses the whole route', () => {
  const r = ring({ scanned: { lower: 4000, upper: 4080 } });
  assert.ok(quotePath(r, toUnits(1)).exact);
  const q = quotePath(r, toUnits(500));
  assert.equal(q.exact, false);
  assert.equal(q.hop, 1);
  assert.equal(q.amountOut, 0n);
});
