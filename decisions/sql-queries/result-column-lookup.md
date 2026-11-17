# Indexing wide result column lookups

A query of SQL text resolves the positions of its selected fields once per result, before decoding any rows.
Up to four selected fields, or fewer than 256 field-to-column comparisons, use a scan for each field.
Larger lookups build a Map of only the requested names, fill their positions in one pass over the result columns, and read them in selection order.
The index belongs to that result; it is not cached between query executions.

The index marks a missing name with `-1` and a duplicate with `-2`.
It reports errors in selection order and ignores duplicate names that are not selected.
A lookup must inspect the entire column list even after finding a name, since a later occurrence makes that name ambiguous.

## Alternatives

- Scanning every column for every field avoids an index allocation, but takes O(fields × columns) work.
- A full-column Map reduces lookup work to O(columns + fields) and is the fastest measured option for wide selections of every column, but allocates an entry for every column even for a sparse selection.
- A Map of only selected names takes O(columns + fields) work and O(fields) index space, giving up some speed on dense selections for lower cost on sparse ones.
- The chosen guard keeps small lookups free of Map allocation and uses the selected-name Map for larger ones.
  The bound limits the scan path to at most four passes or fewer than 256 comparisons; it is a conservative cutoff, not a claim that one cutoff is optimal on every runtime.
- Caching positions on the query would require validating the layout of each result: the statement is compiled at execution, and its columns can differ between executions.
  A result-local index needs no cache invalidation contract.

## Measurements

The [result-columns benchmark](../../benchmarks/runtime/result-columns.bench.ts) runs through the public SQL query API over prepared driver results, with compilation, routing, and decoding but without PostgreSQL, network, or client wire parsing.
It validates positions with a row before timing each case, including those timed with no rows.
Fields are selected in reverse order and spread across the result when only a subset is selected.
Each variant is built with tsdown and measured in six fresh processes per runtime, alternating their order, with 200 ms of warm-up and at least 250 ms of measurement per scenario.
Times are medians in microseconds.
Changes are medians of paired ratios, rather than ratios of the displayed medians; the intervals use the sign test.

The exploratory comparison separates the cost of the index representations:

| Runtime         | Selected / returned columns | Scans, µs | Full Map, µs | Selected-name Map, µs |
| --------------- | --------------------------- | --------: | -----------: | --------------------: |
| Bun 1.4.4       | 4 / 4                       |     0.174 |        0.204 |                 0.244 |
| Bun 1.4.4       | 128 / 128                   |    33.152 |        3.470 |                 4.598 |
| Bun 1.4.4       | 1 / 128                     |     0.384 |        1.800 |                 0.398 |
| Bun 1.4.4       | 16 / 128                    |     4.185 |        2.024 |                 0.958 |
| Node.js 24.18.1 | 4 / 4                       |     0.268 |        0.292 |                 0.334 |
| Node.js 24.18.1 | 128 / 128                   |    48.413 |        4.448 |                 5.655 |
| Node.js 24.18.1 | 1 / 128                     |     0.431 |        3.110 |                 0.848 |
| Node.js 24.18.1 | 16 / 128                    |     6.179 |        3.251 |                 1.868 |

The guarded implementation compared with repeated scans:

| Runtime         | Selected / returned columns | Scans, µs | Guarded index, µs | Paired change, with 96.9% interval |
| --------------- | --------------------------- | --------: | ----------------: | ---------------------------------: |
| Bun 1.4.4       | 4 / 4                       |     0.179 |             0.183 |              +4.4% (+1.1% … +7.0%) |
| Bun 1.4.4       | 16 / 16                     |     0.707 |             0.674 |              -5.3% (-8.8% … -1.8%) |
| Bun 1.4.4       | 64 / 64                     |     9.461 |             2.239 |           -76.0% (-77.7% … -71.9%) |
| Bun 1.4.4       | 128 / 128                   |    33.409 |             4.832 |           -85.7% (-86.3% … -84.5%) |
| Bun 1.4.4       | 1 / 128                     |     0.386 |             0.402 |             +3.8% (-25.9% … +5.7%) |
| Bun 1.4.4       | 16 / 128                    |     4.246 |             0.939 |           -77.9% (-78.4% … -76.3%) |
| Node.js 24.18.1 | 4 / 4                       |     0.283 |             0.274 |              -2.3% (-7.6% … +8.1%) |
| Node.js 24.18.1 | 16 / 16                     |     1.093 |             0.856 |           -19.7% (-25.4% … -12.5%) |
| Node.js 24.18.1 | 64 / 64                     |    14.586 |             3.037 |           -79.1% (-80.1% … -78.7%) |
| Node.js 24.18.1 | 128 / 128                   |    48.757 |             5.695 |           -88.3% (-88.5% … -86.2%) |
| Node.js 24.18.1 | 1 / 128                     |     0.423 |             0.387 |            -10.9% (-16.5% … -5.7%) |
| Node.js 24.18.1 | 16 / 128                    |     6.201 |             1.875 |           -69.4% (-71.3% … -67.7%) |

An interval that includes zero is inconclusive; the measurements do not establish a change for those cases.
The small cases can still have a measurable guard cost: for four fields from 16 columns, Bun measured 0.264 → 0.276 µs.
With one row of 128 fields, the guarded lookup measured 34.472 → 5.629 µs on Bun and 51.992 → 8.862 µs on Node.js.
For 100 rows of 16 fields, both intervals include zero: the lookup is paid once, while row decoding dominates that case.
These are costs of the measured JavaScript, not of complete database queries.

Run the topic with `bun run --cwd benchmarks bench:runtime result-columns --runs 12`; `--base <directory>` compares with a prepared checkout.
