# Converting postgres.js raw rows as they arrive

The postgres.js driver uses `.raw().forEach()` to convert each row to text on arrival.
The completed result provides its column metadata and command count, and the driver returns the accumulated text rows.

Collecting raw rows first keeps every cell's buffer live until the conversion starts.
That approach keeps the conversion loop outside the client's row reader and avoids a callback per row.
