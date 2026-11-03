// Statistics shared by the benchmarks.

/** Median of `values`, the upper of the two middle values when their number is even. */
export function findMedian(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Distribution-free confidence interval of the median of the distribution that `values` independently sample, by the sign test: the order statistics of `findIntervalRank`, with the probability that they cover the median.
 */
export function findMedianInterval(
  values: readonly number[],
  confidence: number,
): { low: number; high: number; coverage: number } {
  const sorted = values.toSorted((a, b) => a - b)
  const { rank, coverage } = findIntervalRank(sorted.length, confidence)
  return { low: sorted[rank - 1]!, high: sorted[sorted.length - rank]!, coverage }
}

/**
 * Rank, counted from 1, of the order statistics `rank` and `count + 1 - rank` of `count` independent values that are the narrowest interval to cover the median of their distribution with probability `confidence` or more, and the probability that it does.
 *
 * With too few values for `confidence`, the interval is their range, of rank 1, with a smaller probability.
 */
export function findIntervalRank(
  count: number,
  confidence: number,
): { rank: number; coverage: number } {
  let rank = 1
  let coverage = findIntervalCoverage(count, 1)
  for (let next = 2; next <= (count + 1) / 2; next++) {
    const nextCoverage = findIntervalCoverage(count, next)
    if (nextCoverage < confidence) {
      break
    }
    rank = next
    coverage = nextCoverage
  }
  return { rank, coverage }
}

/** Probability that the order statistics `rank` and `count + 1 - rank` of `count` independent values cover the median of their distribution: the interval misses it when fewer than `rank` values fall on one side, so it is 1 − 2 P(Binomial(count, ½) < rank). */
function findIntervalCoverage(count: number, rank: number): number {
  // The binomial probabilities are computed from their logarithms, which do not overflow for any count.
  let logProbability = -count * Math.LN2
  let below = 0
  for (let successes = 0; successes < rank; successes++) {
    below += Math.exp(logProbability)
    logProbability += Math.log(count - successes) - Math.log(successes + 1)
  }
  return 1 - 2 * below
}
