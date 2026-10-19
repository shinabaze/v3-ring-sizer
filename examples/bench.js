// Compare three ways to size the same trade on synthetic rings:
//   naive:  1% of the first pool's reserve of the input token
//   search: findBestSize (doubling, golden section, back off)
//   best:   brute force over 4000 sizes, for reference
// Run: node examples/bench.js

import { quotePath, findBestSize, toUnits, fromUnits, virtualReserves } from '../src/index.js';
import { ring } from '../test/helpers.js';

const cost = () => toUnits(0.5);   // a flat 0.5 A per trade, standing in for gas
const profitAt = (r, x) => {
  const q = quotePath(r, toUnits(x));
  return q.exact ? fromUnits(q.amountOut) - x - 0.5 : null;
};

function brute(r) {
  let best = { x: 0, p: -Infinity };
  for (let i = 0; i <= 4000; i++) {
    const x = 10 ** ((i / 4000) * 6);
    const p = profitAt(r, x);
    if (p === null) break;
    if (p > best.p) best = { x, p };
  }
  return best;
}

const cases = [
  ['deep pools, 0.8% edge', { edge: 0.008, depth: [500000, 800000, 300000] }],
  ['medium pools, 1.5% edge', { edge: 0.015 }],
  ['shallow pools, 4% edge', { edge: 0.04, depth: [5000, 8000, 3000] }],
  ['deep pools, 6% edge', { edge: 0.06, depth: [500000, 800000, 300000] }],
  ['thin tick data, 1.5% edge', { edge: 0.015, scanned: { lower: 4020, upper: 4080 } }],
];

const notes = [];
const f = (n, d = 2) => (n === null ? 'refused' : n.toFixed(d));
console.log('case                         | naive size  profit | search size  profit  quotes | best profit | search/best');
for (const [name, opts] of cases) {
  const r = ring(opts);
  const naiveX = fromUnits(virtualReserves(r[0].pool).reserve0) * 0.01;
  const naiveP = profitAt(r, naiveX);
  const s = findBestSize({ quote: a => quotePath(r, a), min: toUnits(1), max: toUnits(1e6), cost });
  if (s.reason !== 'ok') notes.push(`${name}: ${s.reason}`);
  const b = brute(r);
  const sp = s.size > 0n ? fromUnits(s.profit) : 0;
  console.log(
    `${name.padEnd(28)} | ${f(naiveX, 0).padStart(10)} ${f(naiveP).padStart(7)} | ` +
    `${f(fromUnits(s.size), 0).padStart(11)} ${f(sp).padStart(7)} ${String(s.probes).padStart(7)} | ` +
    `${f(b.p).padStart(11)} | ${b.p > 0 ? ((sp / b.p) * 100).toFixed(1) + '%' : '-'}`,
  );
}
for (const n of notes) console.log(n);
