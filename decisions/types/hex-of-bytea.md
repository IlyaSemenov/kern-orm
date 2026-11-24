# Hex of `bytea` converted by the runtime

PostgreSQL writes and reads a `bytea` value as text of hex digits, such as `\x00ff`, which `bytea` converts from and to the bytes of a `Uint8Array` for every value of a parameter and of a result.
The module of `bytea` chooses the conversion once, when it loads:

- `toHex` and `fromHex` of `Uint8Array` where the runtime has them, such as on Bun and Node.js 25;
- `Buffer` of `node:buffer` elsewhere, on Node.js 24, whose decoded bytes it copies into a `Uint8Array` of their own.

Neither checks the digits beyond what the conversion does anyway, since PostgreSQL writes only hex digits: `fromHex` throws at a character that is not one, and `Buffer.from` stops at one, which the length of its result tells, but reads some other characters, such as `ı`, as digits.

The ratios of the [runtime benchmarks](../../development/benchmarks.md#runtime), `decoding` of 1000 records of 10 `bytea` columns of 32 bytes and `preparation` of a query of SQL text of 1000 `bytea` values of 32 bytes, each ratio the time of the whole scenario with the chosen conversion divided by its time with an alternative:

- Against a loop of JavaScript that computes each digit, decoding takes 0.35 on Bun and 0.83 on Node.js, and encoding 0.06 on Bun and 0.30 on Node.js.
- On Node.js, against a loop of JavaScript that reads each digit from a table of character codes, decoding takes 0.71.
- On Node.js, against a loop of JavaScript that appends the digits of each byte from a table of 256 strings, encoding takes 0.60.
- On Node.js, against decoding by `write` of a `Buffer` over the memory of the resulting `Uint8Array`, without a copy, decoding takes 0.56.
- On Bun, against `Buffer`, decoding takes 0.26 and encoding 0.33; decoding with `Buffer` takes 1.3 times as long as the loop that computes each digit.

The alternatives:

- A loop of JavaScript over the digits, computing them or reading them from a table, runs the same code on every runtime and needs neither `node:buffer` nor a choice at load.
  In a microbenchmark of the conversions alone on Node.js, it decoded a value of 16 bytes faster than `Buffer` with its copy, but in the benchmarks above it is slower, and the loop that computes each digit is several times slower than the native conversion in encoding and on Bun.
- Decoding by `write` of a `Buffer` over the memory of a new `Uint8Array` would fill the result without a copy, but it is slower in the benchmark above.
- `toHex` and `fromHex` alone would be the simplest code, but Node.js 24, which the packages support, lacks them.
- `Buffer` alone would need no choice at load, but on Bun it is slower than the native methods, and in decoding slower than a loop of JavaScript too.
- Returning a `Uint8Array` over the memory of the `Buffer` of `Buffer.from`, without the copy, where the `Buffer` takes its memory whole rather than from the pool, would save the copy of a long value, but in a microbenchmark of the conversions alone on Node.js the copy took about 3% of the time of decoding a value of 1 MB.
- Returning the `Buffer` of `Buffer.from` without the copy would save the copy.
  But a `Buffer` is a class other than `Uint8Array`, which deep equality, such as of `assert.deepStrictEqual`, tells apart from the `Uint8Array` that the type returns on other runtimes, and a small `Buffer` is a view of a pool shared with other buffers, which its `buffer` would expose.
