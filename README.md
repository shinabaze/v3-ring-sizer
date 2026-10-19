# v3-ring-sizer

Two things for trading through Uniswap V3 style pools (and Algebra pools, which use the same tick
math):

1. **A quoter that is exact or refuses.** It walks a swap across ticks with the pool's own integer
   math. When the swap would need liquidity outside the ticks you fetched, it says "can't price
   this" instead of returning a number it made up.
2. **A size search.** For a ring (a route that starts and ends in the same token, like an
   arbitrage loop) it finds the input size that earns the most, in about 25 quotes.

About 310 lines of JavaScript, no dependencies, Node 22+. No chain access: you pass in pool
snapshots, and the tests and examples build their own made-up pools.

I wrote the first version for a trading system of mine. Its quoter once ran out of tick data
partway through big swaps and kept going, and its sizer believed the result. This is that method,
rewritten small and on its own.

**Run it:**

```bash
node examples/demo.js
node examples/bench.js
npm test
```

**Use it:**

```js
import { quotePath, findBestSize } from './src/index.js';

const route = [{ pool: poolAB, tokenIn: 'A' }, { pool: poolBC, tokenIn: 'B' }, { pool: poolCA, tokenIn: 'C' }];

quotePath(route, 10n ** 18n);
// { amountOut: 1010875452435945408n, exact: true, reason: 'ok', hop: null }

findBestSize({
  quote: amount => quotePath(route, amount),
  min: 10n ** 18n,                 // smallest size to try
  max: 10n ** 24n,                 // what you can spend or borrow
  cost: () => 5n * 10n ** 17n,     // per-trade cost in the input token, e.g. gas
});
```

A pool snapshot is `{token0, token1, sqrtPriceX96, tick, liquidity, fee, tickSpacing, ticks,
known}`, where `ticks` lists every initialised tick (`{index, liquidityNet}`) inside `known`, the
tick range you scanned. Leave out `ticks` and `known`, and only the current tick spacing can be
quoted.

## How it works

```
quotePath(amount) ─► per hop: walk tick to tick with the pool's math
                         │ needs a tick outside `known`? ──► exact: false, the whole route refuses
                         ▼
findBestSize ─► 1. double the size until profit falls twice, or a quote refuses
                2. golden-section search between half and four times the best size,
                   never above the last size that quoted
                3. back off to 90% of the peak if that keeps 95% of the profit
```

Inside one range a V3 pool is plain `x * y = k`; crossing a tick changes the liquidity. Profit
against size has one peak, which is what makes a search of a few dozen quotes enough.
[docs/explained.md](docs/explained.md) works through both by hand.

## A worked example

`node examples/demo.js`: a ring A to B to C to A, where the last pool pays 1.5% over fair, and a
flat 0.5 A per trade for gas:

```
size in A   back out   profit after 0.5 A gas
        1      1.0109   -0.4891
       10     10.1062   -0.3938
      100    100.8105   0.3105
      200    201.0644   0.5644
     1000    973.5252   -26.9748
    10000     refused   past_known_ticks at hop 0

best size 176.35 A, profit 0.5543 A, 27 quotes, ok
```

Small sizes don't cover the gas, 1,000 A pays more in price impact than the gap is worth, and
10,000 A would need ticks nobody fetched, so it's refused. The search lands at 176 A. 200 A earns
a little more, but it sits right next to the peak. 176 A keeps 98% of that and is further from the
steep side.

`node examples/bench.js` compares it with a common rule of thumb, "trade 1% of the pool", and with
checking 4,000 sizes one by one:

```
case                         | naive size  profit | search size  profit  quotes | best profit | search/best
deep pools, 0.8% edge        |      10000 -329.65 |         642    0.89      27 |        0.91 | 98.5%
medium pools, 1.5% edge      |       1000  -26.98 |         176    0.55      27 |        0.56 | 98.1%
shallow pools, 4% edge       |        100   -0.78 |          51    0.58      23 |        0.60 | 96.9%
deep pools, 6% edge          |      10000  160.78 |        6276  230.06      30 |      234.10 | 98.3%
thin tick data, 1.5% edge    |       1000 refused |         128    0.44      21 |        0.56 | 77.9%
```

The rule of thumb loses money on three rings, asks for a size nobody can price on one, and earns
30% less than the search on the last. The search keeps 97-99% of the best profit with 21 to 30
quotes, except where the tick data is thin (see Limits).

## What I learned

- **A truncated quote looks like a terrible trade.** My first quoter stopped at the edge of its
  tick data but kept the input it had already used. Big sizes came out as huge losses, so the
  sizer shrank every trade to almost nothing. No error, just a wrong number that looked real.
- **Constant liquidity is optimistic.** Single-range math assumes liquidity never changes, and
  real pools thin out away from the price. Run past the range and output is overstated, which
  shows up as profit that isn't there. Without tick data only the current range counts now.
- **A refused size is unknown, not unprofitable.** Score it as a loss and the search drifts small.
  Ignore it and the search trusts guesses. Stopping there is the only honest option.
- **Return where you left the pool.** An early version worked out the new price and threw it away,
  which nothing noticed until something asked what the pool looked like after the swap. The test
  "one big swap equals two smaller ones" catches that.

## Limits

- No chain reader. You bring the snapshot: price, tick, liquidity, the initialised ticks and the
  range you scanned.
- Exact-input swaps only, no price limit. The fee is taken off the whole input at once, which can
  differ from the contract by a few wei. Pools with a fee that changes per swap need the current
  fee in the snapshot.
- The search assumes one peak. A cost that jumps at some size can break that.
- It never searches above the last doubling that quoted. With thin tick data the best size can sit
  between that and the first refusal: the last bench row keeps 78%.
- Synthetic pools only in the tests. Before trusting it with money, compare it with an on-chain
  quoter at a pinned block.

## Files

```
src/       tickmath.js  quoter.js  search.js  pools.js (made-up pools)  index.js
test/      node:test, including the cases that once went wrong
examples/  demo.js  bench.js
docs/      explained.md, decisions.md
```

MIT licence. Copyright 2026 Shinabaze Ajiya.
