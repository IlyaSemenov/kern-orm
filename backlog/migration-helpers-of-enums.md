# Migration helpers of enums

Helpers that change enum types: PostgreSQL cannot drop a value of an enum, so undoing an added value creates the type again with the columns that use it.
