# Reusing PostgreSQL date and time fields

For a four-digit AD year, PostgreSQL in ISO DateStyle already writes the date in the format the decoder returns.
A timestamp without a time zone or with the UTC offset needs only a `T` separator, six fractional digits and, for UTC, a `Z` suffix.
With a nonzero offset, the decoder subtracts the offset in seconds and reuses the date when the result is within the same day.
The calendar conversion handles day boundaries and astronomical years.

Using one regular expression with captures per type would handle every year and offset uniformly.
However, even for four-digit years it would extract and reformat fields, and converting every instant through a Gregorian day count would also do calendar arithmetic for UTC values.

In the [decoding benchmark](../../benchmarks/runtime/decoding.bench.ts), each query returns 1000 records of 10 columns.
The median ratios of query time to the version that extracts and reformats every field, over six pairs of processes per runtime, are:

| Columns                                  | Bun 1.4.4 | Node.js 24.18.1 |
| ---------------------------------------- | --------: | --------------: |
| `date`                                   |      0.13 |            0.16 |
| `time`                                   |      0.53 |            0.43 |
| `timestamp`                              |      0.36 |            0.37 |
| `timestamptz` in UTC                     |      0.11 |            0.12 |
| `timestamptz` with nonzero offsets       |      0.76 |            0.77 |
| Mixed records with one UTC `timestamptz` |      0.37 |            0.52 |
