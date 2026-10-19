import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqrtPriceAtTick, Q96, MIN_TICK, MAX_TICK } from '../src/tickmath.js';

test('known values at tick 0 and at both ends', () => {
  assert.equal(sqrtPriceAtTick(0), Q96);
  assert.equal(sqrtPriceAtTick(MIN_TICK), 4295128739n);
  assert.equal(sqrtPriceAtTick(MAX_TICK), 1461446703485210103287273052203988822378723970342n);
});

test('every bit of the tick agrees with 1.0001^(tick/2)', () => {
  for (let b = 0; b < 19; b++) {
    for (const t of [1 << b, -(1 << b), (1 << b) + 3, -((1 << b) + 7)]) {
      const exact = Number(sqrtPriceAtTick(t)) / Number(Q96);
      const float = Math.exp((t * Math.log(1.0001)) / 2);
      assert.ok(Math.abs(exact / float - 1) < 1e-11, `tick ${t}`);
    }
  }
});

test('prices rise with the tick', () => {
  let prev = sqrtPriceAtTick(-1000);
  for (let t = -999; t <= 1000; t++) {
    const p = sqrtPriceAtTick(t);
    assert.ok(p > prev, `tick ${t}`);
    prev = p;
  }
});

test('refuses ticks out of range', () => {
  assert.throws(() => sqrtPriceAtTick(MAX_TICK + 1), RangeError);
  assert.throws(() => sqrtPriceAtTick(1.5), RangeError);
});
