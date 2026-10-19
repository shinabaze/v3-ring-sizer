# Decisions

Short reasons for the choices that look odd at first.

**Refuse, never guess.** A quote that runs past the known ticks is wrong either way: carry on with
the last liquidity and it is too good, stop early and it is too bad. Both look like real numbers.
A refusal can't be mistaken for a price, so the caller has to deal with it.

**The scanned range is explicit.** A pool snapshot carries `known: {lower, upper}`, the tick range
someone actually scanned. Working it out from the lowest and highest tick in the list can't tell
"there are no ticks here" from "nobody looked here", and those need opposite answers.

**No tick list means only the current spacing is known.** Inside one spacing, liquidity can't
change, so single-range math is exact there and nowhere else. A tick list without its range is an
error, not a guess.

**Exact integer tick math.** `1.0001^tick` in floating point drifts at large ticks and can put a
range edge on the wrong side of the price. The integer version gives the same answer as the
contract at every tick.

**Inputs round up, outputs round down.** That is the pool's side of every rounding, the same as on
chain, so a quote never promises a trader more than the pool would pay.

**The fee comes off the whole input first.** The contract takes it step by step, which changes the
result by a few wei at most. Taking it once keeps the loop simple.

**A refused size stops the doubling.** A bigger swap can only need more of the pool, so if one size
can't be quoted, no bigger size can. The search never looks above the last size it could quote.

**Two falls before stopping.** A cost that isn't flat (a fee with a minimum, a rounding step) can
make the curve dip once before the real peak. One fall is not enough evidence to stop.

**The cost is a function you pass in.** Gas, fees and anything else per trade differ by chain and
by route. The search only needs a number in the input token.

**Back off 10% when it keeps 95%.** The far side of the peak is steeper than the near side, so
slightly small is safer than slightly big. The 95% rule stops the back-off when the peak is sharp
and 10% less would cost real profit.
