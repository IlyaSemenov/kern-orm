# Orchid interoperability runtime overhead

The benchmark compares native Orchid ORM 1.78.61 (pqb 0.73.50) with two versions of the adapter, one that collects all raw rows before converting them to text and one that converts each row on arrival.
All runs used postgres.js 4.0.0 and the same local PostgreSQL 18.4 database on Apple M3 Pro, macOS 27.0.1 arm64.
The client runtimes were Bun 1.4.4 and Node.js 24.18.1.
The [benchmark script](orchid-interop.ts) gives the commands for timing, protocol exchanges, and peak RSS.
The Bun runs used compiled workspace packages, verified through `require.cache` after execution.

Timing uses 15 pairs per runtime and scenario, alternating side order after warmup.
CPU is process user plus system time, including client I/O, JavaScript and GC.
The absolute numbers are per-side medians, and each percentage is the median of the paired ratios, so it can differ from the ratio of the displayed medians.
CRUD and recoverable results are in µs per query, and large reads and tests are in ms per query or per test.
Protocol exchanges were counted separately by PostgreSQL frontend Query, Flush and Sync boundaries.
Counts cover 1,000 CRUD calls, one large read, 200 recoverable calls, or one test, respectively, and include the transaction boundaries for each batch.
Parameterized statements in this fixture exchange a description before binding.
The large raw SQL reads have no parameters, so native Orchid uses the simple protocol and the adapter uses the extended protocol, with one exchange each.
The two runtimes gave identical exchange counts before and after the driver change.

## Original adapter against native Orchid

### Bun

| Scenario               |                     Wall |               Client CPU | Exchanges per batch |
| ---------------------- | -----------------------: | -----------------------: | ------------------: |
| PK select, pool        |    65.47 → 66.44 (+0.9%) |    34.72 → 37.09 (+0.7%) |                2000 |
| PK select, transaction |    65.36 → 66.80 (+2.5%) |    28.03 → 30.25 (+4.7%) |                2002 |
| PK update, pool        |  123.73 → 118.11 (-2.3%) |    28.07 → 28.53 (+1.7%) |                2000 |
| PK update, transaction |    70.75 → 72.17 (+0.8%) |    26.93 → 27.47 (+2.2%) |                2002 |
| Object rows, 1k        |     0.68 → 1.24 (+78.5%) |     0.62 → 1.33 (+97.5%) |                   1 |
| Object rows, 10k       |    6.47 → 12.18 (+85.6%) |   6.94 → 15.71 (+131.2%) |                   1 |
| Object rows, 100k      |  64.40 → 111.95 (+74.9%) | 65.88 → 148.28 (+104.4%) |                   1 |
| Array rows, 1k         |     0.67 → 1.25 (+89.0%) |    0.63 → 1.27 (+119.7%) |                   1 |
| Array rows, 10k        |    6.43 → 11.80 (+85.5%) |   6.70 → 14.91 (+115.1%) |                   1 |
| Array rows, 100k       |  64.02 → 112.45 (+76.6%) |  73.29 → 148.11 (+99.3%) |                   1 |
| Recoverable insert     | 125.40 → 156.16 (+24.5%) |   65.30 → 79.23 (+31.9%) |    702 → 902 (+28%) |
| Recoverable find       |  98.12 → 143.47 (+46.2%) |   47.05 → 77.67 (+60.5%) |    602 → 902 (+50%) |
| Test body              |     0.97 → 1.36 (+40.5%) |     0.52 → 0.78 (+59.2%) |      27 → 48 (+78%) |

### Node.js

| Scenario               |                     Wall |               Client CPU | Exchanges per batch |
| ---------------------- | -----------------------: | -----------------------: | ------------------: |
| PK select, pool        |   69.17 → 74.62 (+10.2%) |    42.78 → 43.52 (+6.7%) |                2000 |
| PK select, transaction |    69.02 → 74.64 (+6.8%) |   38.71 → 41.53 (+15.6%) |                2002 |
| PK update, pool        |  113.90 → 115.25 (+2.0%) |   36.02 → 40.76 (+13.0%) |                2000 |
| PK update, transaction |    73.20 → 75.02 (-1.1%) |    33.62 → 35.26 (+9.3%) |                2002 |
| Object rows, 1k        |    0.71 → 1.51 (+112.0%) |    0.66 → 1.48 (+121.3%) |                   1 |
| Object rows, 10k       |   6.21 → 14.41 (+131.3%) |   6.33 → 15.17 (+135.6%) |                   1 |
| Object rows, 100k      | 60.90 → 161.35 (+156.5%) | 81.54 → 251.34 (+178.4%) |                   1 |
| Array rows, 1k         |    0.71 → 1.45 (+106.0%) |    0.66 → 1.40 (+113.2%) |                   1 |
| Array rows, 10k        |   6.18 → 13.96 (+125.4%) |   6.08 → 14.52 (+141.5%) |                   1 |
| Array rows, 100k       | 70.00 → 159.86 (+131.9%) | 85.25 → 252.96 (+204.1%) |                   1 |
| Recoverable insert     | 138.97 → 180.68 (+28.8%) |  81.19 → 112.97 (+32.6%) |    702 → 902 (+28%) |
| Recoverable find       | 106.34 → 164.93 (+57.0%) |   56.80 → 93.56 (+66.0%) |    602 → 902 (+50%) |
| Test body              |     1.03 → 1.44 (+39.0%) |     0.66 → 0.85 (+43.8%) |      27 → 48 (+78%) |

## Adapter with incremental driver conversion against native Orchid

### Bun

| Scenario               |                     Wall |              Client CPU | Exchanges per batch |
| ---------------------- | -----------------------: | ----------------------: | ------------------: |
| PK select, pool        |    63.88 → 65.29 (+1.9%) |   37.04 → 34.03 (+4.9%) |                2000 |
| PK select, transaction |    65.42 → 67.18 (+2.8%) |   28.92 → 31.44 (+8.5%) |                2002 |
| PK update, pool        |  125.42 → 124.70 (-0.6%) |   27.78 → 29.37 (+1.9%) |                2000 |
| PK update, transaction |    70.88 → 71.66 (+1.5%) |   27.01 → 28.78 (+4.8%) |                2002 |
| Object rows, 1k        |     0.68 → 1.13 (+64.3%) |    0.62 → 1.23 (+84.3%) |                   1 |
| Object rows, 10k       |    6.27 → 10.40 (+65.9%) |   6.62 → 13.16 (+99.5%) |                   1 |
| Object rows, 100k      |   62.86 → 96.67 (+54.6%) | 73.54 → 129.56 (+69.8%) |                   1 |
| Array rows, 1k         |     0.68 → 1.17 (+69.7%) |    0.64 → 1.21 (+87.6%) |                   1 |
| Array rows, 10k        |    6.39 → 10.79 (+70.4%) |   7.32 → 13.57 (+82.6%) |                   1 |
| Array rows, 100k       |  62.29 → 100.22 (+61.7%) | 73.06 → 135.90 (+89.5%) |                   1 |
| Recoverable insert     | 130.12 → 158.13 (+20.0%) |  67.30 → 86.31 (+28.2%) |    702 → 902 (+28%) |
| Recoverable find       | 100.70 → 144.24 (+44.6%) |  50.50 → 78.67 (+50.5%) |    602 → 902 (+50%) |
| Test body              |     0.94 → 1.33 (+42.3%) |    0.48 → 0.73 (+60.3%) |      27 → 48 (+78%) |

### Node.js

| Scenario               |                     Wall |               Client CPU | Exchanges per batch |
| ---------------------- | -----------------------: | -----------------------: | ------------------: |
| PK select, pool        |    70.22 → 76.57 (+8.3%) |   42.09 → 45.99 (+16.1%) |                2000 |
| PK select, transaction |    70.23 → 70.02 (+0.5%) |    37.61 → 38.00 (+6.2%) |                2002 |
| PK update, pool        |  116.09 → 123.18 (+8.0%) |    35.19 → 38.67 (+8.8%) |                2000 |
| PK update, transaction |    76.72 → 78.42 (+1.7%) |    34.39 → 37.44 (+7.7%) |                2002 |
| Object rows, 1k        |    0.70 → 1.48 (+109.5%) |    0.65 → 1.42 (+118.6%) |                   1 |
| Object rows, 10k       |   6.15 → 15.17 (+146.4%) |   6.54 → 15.81 (+155.5%) |                   1 |
| Object rows, 100k      | 64.89 → 145.25 (+124.2%) | 84.80 → 185.52 (+114.2%) |                   1 |
| Array rows, 1k         |    0.70 → 1.47 (+112.1%) |    0.64 → 1.41 (+122.3%) |                   1 |
| Array rows, 10k        |   6.17 → 15.27 (+146.1%) |   6.52 → 15.91 (+141.5%) |                   1 |
| Array rows, 100k       | 67.96 → 143.34 (+115.7%) |  93.92 → 188.26 (+99.8%) |                   1 |
| Recoverable insert     | 138.63 → 179.46 (+29.7%) |  80.76 → 116.72 (+38.5%) |    702 → 902 (+28%) |
| Recoverable find       | 106.66 → 160.26 (+51.2%) |   57.29 → 90.05 (+55.6%) |    602 → 902 (+50%) |
| Test body              |     1.02 → 1.44 (+41.7%) |     0.58 → 0.96 (+49.9%) |      27 → 48 (+78%) |

## Peak client RSS

Median increase in process high-water RSS over the peak immediately after a one-row warmup, in MiB, with three fresh processes per cell.
A zero means the read did not set a new high-water mark, so there is no percentage when native Orchid reports zero.
Each cell is native Orchid → adapter.

| Runtime | Scenario          |               Original | Incremental conversion |
| ------- | ----------------- | ---------------------: | ---------------------: |
| Bun     | Object rows, 1k   |      0.00 → 0.38 (n/a) |      0.00 → 0.83 (n/a) |
| Bun     | Object rows, 10k  |   7.69 → 24.73 (+222%) |   8.59 → 17.69 (+106%) |
| Bun     | Object rows, 100k | 74.28 → 174.88 (+135%) |  73.55 → 119.03 (+62%) |
| Bun     | Array rows, 1k    |      0.00 → 0.38 (n/a) |      0.00 → 1.41 (n/a) |
| Bun     | Array rows, 10k   |   7.94 → 23.84 (+200%) |   8.05 → 18.38 (+128%) |
| Bun     | Array rows, 100k  | 76.77 → 178.75 (+133%) |  74.20 → 120.52 (+62%) |
| Node.js | Object rows, 1k   |    0.67 → 3.58 (+433%) |    0.56 → 3.20 (+469%) |
| Node.js | Object rows, 10k  |   7.67 → 23.23 (+203%) |    7.62 → 14.80 (+94%) |
| Node.js | Object rows, 100k | 64.34 → 258.58 (+302%) | 54.48 → 110.52 (+103%) |
| Node.js | Array rows, 1k    |    0.67 → 3.59 (+435%) |    0.55 → 3.27 (+497%) |
| Node.js | Array rows, 10k   |   7.73 → 23.56 (+205%) |    7.61 → 15.08 (+98%) |
| Node.js | Array rows, 100k  | 65.33 → 261.31 (+300%) | 56.06 → 112.92 (+101%) |

## Direct comparison of the driver conversion

The two builds read the same data, with 19 alternating pairs per runtime for each of the six large reads.
The intervals are distribution-free confidence intervals for the median paired change, with at least 95% coverage.
The absolute numbers come from a separate run from the native comparisons above.

| Runtime | Scenario          |                                 Wall, ms |                            Client CPU, ms |
| ------- | ----------------- | ---------------------------------------: | ----------------------------------------: |
| Bun     | Object rows, 1k   |     2.15 → 1.84 (-14.5%) [-21.0%, -5.4%] |       1.43 → 1.39 (-8.6%) [-13.6%, +5.2%] |
| Bun     | Object rows, 10k  |  12.15 → 10.74 (-11.8%) [-13.6%, -10.5%] |     15.02 → 13.18 (-9.0%) [-14.1%, -6.1%] |
| Bun     | Object rows, 100k | 117.15 → 98.49 (-14.8%) [-18.9%, -11.7%] | 154.76 → 126.54 (-22.5%) [-28.3%, -10.1%] |
| Bun     | Array rows, 1k    |    1.60 → 1.09 (-26.4%) [-36.4%, -20.6%] |      1.26 → 1.06 (-13.4%) [-25.9%, -2.2%] |
| Bun     | Array rows, 10k   |    11.40 → 9.96 (-12.7%) [-15.3%, -7.8%] |     14.20 → 12.79 (-9.0%) [-18.6%, +1.2%] |
| Bun     | Array rows, 100k  | 107.72 → 90.87 (-17.3%) [-20.3%, -12.9%] | 143.37 → 118.56 (-20.3%) [-27.0%, -12.2%] |
| Node.js | Object rows, 1k   |     2.74 → 2.39 (-13.6%) [-21.2%, -6.8%] |        1.53 → 1.63 (+5.5%) [-2.6%, +9.4%] |
| Node.js | Object rows, 10k  |   15.11 → 16.73 (+10.5%) [+7.6%, +15.8%] |   15.10 → 17.52 (+15.7%) [+11.7%, +21.2%] |
| Node.js | Object rows, 100k |   174.53 → 164.83 (-5.6%) [-7.8%, -3.8%] | 273.84 → 210.66 (-22.9%) [-27.2%, -13.6%] |
| Node.js | Array rows, 1k    |     2.90 → 2.56 (-10.4%) [-17.7%, -0.4%] |       1.55 → 1.68 (+7.7%) [+5.1%, +11.5%] |
| Node.js | Array rows, 10k   |   14.75 → 16.01 (+10.5%) [+5.7%, +14.4%] |    14.81 → 16.61 (+14.8%) [+8.4%, +17.6%] |
| Node.js | Array rows, 100k  |   160.28 → 151.62 (-4.7%) [-6.5%, -2.2%] | 255.61 → 198.51 (-22.4%) [-24.8%, -17.6%] |

The paired intervals for indexed loops after collecting the entire raw result generally crossed zero.
At 100k, the paired change in wall time for Bun object rows was −2.1% [−6.2%, +2.3%].
Node.js array wall time went from 164.56 to 166.51 ms, also with an interval crossing zero.
Separating the array and object decoder also lacked a consistent win.
With incremental conversion, splitting the decoder cut wall time for 1k array rows on Bun by 7.4% [−9.4%, −4.1%].
The larger Bun array intervals included zero.
In isolation it increased 10k array CPU on Node.js from 14.39 to 15.67 ms (+9% paired).
The retained change is incremental conversion of each row with `.raw().forEach()`.
It lets postgres.js release each raw row without accumulating all of its cell buffers alongside the text rows.

## What the hypotheses got right

1. Ordinary CRUD used the same number of exchanges on both sides.
   With the original adapter, the increase in median client CPU was at most 4.8 µs per query, with several paired intervals crossing zero.
2. The original large-result CPU overhead was +98–131% on Bun and +113–204% on Node.js for this workload.
   At 100k rows, peak client RSS growth was about 2.3–2.4× on Bun and 4.0× on Node.js.
   This measures the whole result path, including copied raw buffers, string conversion, materialization and GC.
3. Recoverable inserts added one exchange per call on either outcome.
   A recoverable find added one for a hit and two for a miss.
   In pqb 0.73.50, `setCatchingSavepoint` creates the scope and `execQuery` selects the ordinary savepoint for these single-statement queries.
   `hackySavepoint` keeps a savepoint open for queries that need it across later statements.
   postgres.js 4.0.0 sends no release on success and rolls back to the savepoint for a server-side failure.
   A missing row becomes `NotFoundError` after the native savepoint callback completed.
   The Kern adapter releases each savepoint and rolls back when the full recoverable Orchid query rejects.
4. Each of the ten successful statements outside a user transaction added two exchanges in the test.
   The explicit user transaction added one more exchange because Kern releases its savepoint.
   The complete test used 27 → 48 exchanges and the original adapter took about 39–41% more wall time.

## Remaining opportunities

A temporary 100k-row probe compared the retained adapter with two direct-client paths, each with 15 alternating pairs and the same PostgreSQL extended protocol.
The fused path used `.raw().forEach()` and called the OID-selected Orchid parser in the row callback, removing the intermediate text matrix while still allocating a Buffer for each non-null cell.
The native path used `.unsafe()` for objects and `.unsafe().values()` for arrays, so postgres.js decoded rows from the wire.
Both probes bypassed Kern routing and the Orchid execution wrapper.
Their timings estimate the headroom for a result API.

| Runtime | Shape   |      Wall, adapter → fused |     Wall, adapter → native |
| ------- | ------- | -------------------------: | -------------------------: |
| Bun     | Objects |   97.60 → 97.35 ms (-3.1%) |  96.90 → 63.21 ms (-34.2%) |
| Bun     | Arrays  |  101.80 → 94.18 ms (-6.5%) |  94.24 → 63.36 ms (-32.1%) |
| Node.js | Objects | 144.22 → 143.05 ms (−1.9%) | 161.86 → 70.91 ms (−57.9%) |
| Node.js | Arrays  | 141.86 → 134.92 ms (−2.4%) | 154.71 → 69.76 ms (−54.9%) |

Fusing conversion and decoding cut wall time on Bun by 3.1% for objects [−7.6%, −0.3%] and 6.5% for arrays [−8.6%, −4.8%].
Both Node.js intervals included zero.
The native path's 32–58% reduction in wall time is an estimate of the upper end of the gain, since an integrated path would still pay for routing, error handling, and the wrapper.
If large reads become a bottleneck for an application using the adapter, measure native decoding through Kern with the workload that exposed it.

For expected conflicts, use an insert that ignores the conflict if its conflict target and return behavior match the caller's needs.
For expected misses, an optional find avoids recovery and returns an optional result.
Exchanging error recovery for value-level outcomes can remove two savepoint exchanges on a success and three on a failure in these Kern scenarios.
For database tests, grouping ten statements inside one user transaction can replace their 20 individual savepoint exchanges with two exchanges around the group, but changes the rollback boundary and the behavior under test.
