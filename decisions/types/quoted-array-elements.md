# Decoding quoted array elements in slices

PostgreSQL quotes array elements that contain spaces, commas, or characters such as quotes and backslashes.
The decoder scans a quoted element for its closing quote and takes the whole element as one slice when it has no escapes.
At a backslash it appends the preceding slice and starts the next slice at the escaped character.

Appending each character as the scanner passes it needs no slice boundaries, but it builds intermediate strings even for an element without escapes.

The [decoding benchmark](../../benchmarks/runtime/decoding.bench.ts) returns 1000 records of 10 text arrays, each with two elements.
The median ratios of query time with slices to appending each character, over eight pairs of processes per runtime, are:

| Elements                                          | Bun 1.4.4 | Node.js 24.18.1 |
| ------------------------------------------------- | --------: | --------------: |
| Short strings with spaces                         |      0.58 |            0.57 |
| Long strings with spaces                          |      0.45 |            0.15 |
| Short strings with escaped quotes and backslashes |      0.91 |            0.78 |
