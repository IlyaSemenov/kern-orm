# `literal` of a value and `unsafeSql` of text

`literal` writes a value as a SQL literal by its kind, and `unsafeSql` interpolates text as it is, for the places of a statement where PostgreSQL takes no parameter.

```ts
await database.query`ALTER TABLE ${identifier(table)} ALTER COLUMN id RESTART WITH ${literal(nextId)}`
await database.query`ALTER TABLE form ALTER COLUMN ${identifier(column)} TYPE ${unsafeSql(columnType)}`
```

The alternatives:

- `unsafeSql` alone would be one function for every such place.
  But every caller would quote the values that it writes, and a mistake in the quoting is a SQL injection.
- A number quoted, as `quote_literal` and `format('%L')` of PostgreSQL write it, such as `'5'`, would be typed by its place as a parameter is.
  But the places of a numeric constant, such as `RESTART WITH`, `START WITH`, and `INCREMENT BY`, reject a quoted literal, and they are where a statement needs a number without a parameter.
- A negative number in parentheses, such as `(-5)`, would keep its minus before a cast, which binds tighter: `-5::text` is the minus of a text.
  But the places of a numeric constant reject parentheses too.
- A space before a negative number and before an escape string, such as ` -5` and ` E'a\\b'`, would keep `1 -${literal(-2)}` from the comment `--2`, and the `E` from a word before it.
  But a negative number needs parentheses before a cast anyway, so the parentheses of a template cover its minus in both places.
  A space of the template separates an escape string from a word before it, and the literal of a string is the text that `quote_literal` writes.
- A string with a backslash written without `E`, as SQL written by hand has it, would write every string as a plain quoted literal.
  But in a session with `standard_conforming_strings` off its backslashes are escapes, which change its value and may take its closing quote.
- An integer number beyond the safe integers written by its digits, as a parameter takes it, would take a number of any size, such as `1e21`.
  But a literal mostly writes the values of sequences and identifiers, where a number that lost its digits is a wrong value that nothing rejects.
- A function of keywords checked against the characters of a word, such as `keyword("DESC")`, would reject text of more than a word.
  But a word of a user is still any keyword, a fragment of `sql` already writes a keyword chosen among a few, and the texts left, such as the name of a type with its modifiers or a comment, are not words.
- The name `rawSql`, or `raw` as a member of `sql`, would be shorter and name what the function does rather than its risk.
  But the call would not tell a reviewer that nothing checks the text, and `identifier` and `joinSql` are functions of their own ([decision](identifier-function.md)).
