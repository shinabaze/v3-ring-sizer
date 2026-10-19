// A ring A -> B -> C -> A on three made-up pools, where the last pool pays 1.5% over fair.
// Run: node examples/demo.js

import { quotePath, findBestSize, toUnits, fromUnits } from '../src/index.js';
import { ring } from '../test/helpers.js';

const route = ring({ edge: 0.015 });
const gas = toUnits(0.5);

console.log('size in A   back out   profit after 0.5 A gas');
for (const x of [1, 10, 100, 200, 1000, 10000]) {
  const q = quotePath(route, toUnits(x));
  const line = q.exact
    ? `${fromUnits(q.amountOut).toFixed(4).padStart(10)}   ${(fromUnits(q.amountOut) - x - 0.5).toFixed(4)}`
    : `   refused   ${q.reason} at hop ${q.hop}`;
  console.log(`${String(x).padStart(9)}  ${line}`);
}

const best = findBestSize({ quote: a => quotePath(route, a), min: toUnits(1), max: toUnits(1e6), cost: () => gas });
console.log(`\nbest size ${fromUnits(best.size).toFixed(2)} A, profit ${fromUnits(best.profit).toFixed(4)} A, ` +
  `${best.probes} quotes, ${best.reason}`);
