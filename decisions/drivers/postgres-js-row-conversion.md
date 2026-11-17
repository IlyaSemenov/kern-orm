# Converting postgres.js raw rows as they arrive

The postgres.js driver uses `.raw().forEach()` to convert each row to text on arrival.
The completed result provides its column metadata and command count, and the driver returns the accumulated text rows.

Collecting raw rows first keeps every cell's buffer live until the conversion starts.
That approach keeps the conversion loop outside the client's row reader and avoids a callback per row.
In the [Orchid interoperability benchmark](../../benchmarks/suites/orchid-interop.md), conversion on arrival cut wall time for 100,000 rows by 15–17% on Bun and 5–6% on Node.js, depending on row shape.
On Node.js the 10,000-row reads took about 10% longer in both row shapes, while peak memory growth fell from about 23 MiB to 15 MiB.
Moving the same conversion into indexed loops after collecting the raw result gave no consistent gain.
