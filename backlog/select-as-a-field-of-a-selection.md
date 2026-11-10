# `$select` as a field of a selection

A query of `$select` as a field of a selection, such as of `select` or of another `$select`, nested as the rows of a query of a table are: packing reads a statement without a source through a derived source like any other, so it needs `RecordQuery` among the nested queries of a selection and its node in the nested selection node.
