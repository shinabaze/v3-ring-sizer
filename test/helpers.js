import { makePool, liquidityFor } from '../src/pools.js';

// Two positions around the price: a wide one, and a deeper one close in.
export function positions(price, depth, spacing, wide = 120, close = 10) {
  const t = Math.floor(Math.log(price) / Math.log(1.0001));
  const c = Math.floor(t / spacing) * spacing;
  return [
    { lower: c - wide * spacing, upper: c + wide * spacing, liquidity: liquidityFor(price, depth) },
    { lower: c - close * spacing, upper: c + close * spacing, liquidity: liquidityFor(price, depth * 3) },
  ];
}

// A ring A -> B -> C -> A where the last pool pays `edge` more than fair.
export function ring({ edge = 0.015, depth = [50000, 80000, 30000], scanned } = {}) {
  const fair = 1 / (2 * 1.5);
  const ab = makePool({ token0: 'A', token1: 'B', price: 2, fee: 500, tickSpacing: 10, positions: positions(2, depth[0], 10) });
  const bc = makePool({ token0: 'B', token1: 'C', price: 1.5, fee: 3000, tickSpacing: 60, positions: positions(1.5, depth[1], 60), scanned });
  const ca = makePool({ token0: 'C', token1: 'A', price: fair * (1 + edge), fee: 500, tickSpacing: 10, positions: positions(fair * (1 + edge), depth[2], 10) });
  return [{ pool: ab, tokenIn: 'A' }, { pool: bc, tokenIn: 'B' }, { pool: ca, tokenIn: 'C' }];
}
