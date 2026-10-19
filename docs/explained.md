# Concentrated liquidity and trade sizing, explained from scratch

## Ticks and liquidity

A Uniswap V3 style pool doesn't spread its money over every possible price. Each liquidity
provider picks a price range, and their money only trades while the price is inside it.

Prices are cut into ticks. Tick `t` is the price `1.0001^t`, so one tick is a 0.01% step. A pool
only lets ranges start and end on multiples of its tick spacing (10, 60, 200...).

`liquidity` (L) is how much money is active at the current price. Each range edge is an
initialised tick with a `liquidityNet`: the amount that switches on when the price crosses it going
up (and off going down). So a pool is a list of these edges plus the current price and L.

## Inside one range it is just x * y = k

While the price stays between two initialised ticks, L is constant and the pool behaves exactly
like an old constant-product pool with "virtual" reserves:

```
x = L / sqrtPrice        (token0)
y = L * sqrtPrice        (token1)
```

The test pool in `test/quoter.test.js`: price 2, L = 141,421, so sqrtPrice = 1.41419 and
x = 100,001.34 A, y = 199,996.31 B. Swap 10 A in with a 0.3% fee: 9.97 A reaches the pool and

```
out = y * dx / (x + dx) = 199,996.31 * 9.97 / 100,011.31 = 19.9374 B
```

`quoteSwap` gives 19.937377487815503 B, the same number to every printed digit.

## Crossing ticks

A bigger swap moves the price out of the current range. When it reaches an initialised tick, L
changes by that tick's `liquidityNet`, and the swap continues with the new L. The test pool has a
deep range from tick 6300 to 7500 (prices 1.878 to 2.117) inside a wide one. Selling 6,000 A pushes
the price below 1.878, out of the deep range, and the pool carries on with only the wide range's
L of 35,355.

So a quoter walks from edge to edge: work out how much input reaches the next edge, spend it,
cross, repeat until the input runs out.

## Why it must be able to refuse

You only know the edges you fetched. If a swap needs to go past the last one you know about, the
liquidity out there is a guess. Keep going with the last L and the quote is usually too good,
because pools tend to thin out away from the price. Stop and return what you have, and the quote
is far too bad, because input was spent with no output for the rest.

Both are wrong in a way that looks like a real number. So `quoteSwap` returns `exact: false` and a
reason instead, and the size is dropped.

## Why profit against size has one peak

On a ring (A to B to C and back to A) the profit at size `x` is `out(x) - x - cost`. Each extra
unit you trade gets a slightly worse price than the one before, so `out(x)` bends down. Profit
rises while the price gap pays more than the impact costs, then falls. One peak.

That shape is what makes a cheap search possible:

1. **Double.** Try 1, 2, 4, 8... until profit falls twice in a row. The peak is now inside a
   bracket of a few doublings.
2. **Golden section.** Keep two points inside the bracket, drop the side with the worse one, and
   reuse the other point next round. Each round shrinks the bracket to 0.618 of its size with one
   new quote. From an 8x bracket to 1% takes about 15 quotes.
3. **Back off.** Take 90% of the peak if that keeps 95% of the profit. Past the peak the curve
   drops faster than it rises, and a price that moves between quote and trade can push the peak
   size onto that side.

The demo does all three in 27 quotes. Checking 4,000 sizes one by one, as the bench does for
reference, finds a profit only 2% higher.
