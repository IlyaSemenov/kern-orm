// Structure of a PostgreSQL schema as lines of text, which the verification compares before a migration and after its rollback.
import type { Database } from "kern-db"

/**
 * SQL of the items of ACL `acl` in the order of their bytes, such as `{=X/app,app=X/app}`, so that the same privileges match whatever the order of their grants.
 *
 * It keeps `NULL`, the default privileges, apart from `{}`, an ACL that grants nothing.
 */
function sortAcl(acl: string): string {
  return `CASE WHEN ${acl} IS NOT NULL THEN '{' || coalesce((SELECT string_agg(item::text, ',' ORDER BY item::text COLLATE "C") FROM unnest(${acl}) AS item), '') || '}' END`
}

/**
 * SQL of ` GRANT <items>` for ACL `acl` of an object of kind `kind` of `acldefault`, owned by `owner`, or `NULL` for its default privileges.
 *
 * A grant and its revoke leave an explicit ACL, which matches no grant when its items are those of the default ACL.
 */
function formatGrant(acl: string, kind: string, owner: string): string {
  const defaultAcl = `pg_catalog.acldefault(${kind}, ${owner})`
  return `' GRANT ' || nullif(${sortAcl(`coalesce(${acl}, ${defaultAcl})`)}, ${sortAcl(defaultAcl)})`
}

/** SQL of ` OWNER <role>` for owner `owner` other than the role of `$2`, which owns the objects that the migrations create, or `NULL`. */
function formatOwner(owner: string): string {
  return `CASE WHEN ${owner} IS DISTINCT FROM (SELECT oid FROM default_owner) THEN ' OWNER ' || pg_catalog.pg_get_userbyid(${owner}) END`
}

/** SQL of the options of `options`, such as of a table, in the order of their bytes, as PostgreSQL keeps them in the order of their last change. */
function sortOptions(options: string): string {
  return `(SELECT string_agg(option, ', ' ORDER BY option COLLATE "C") FROM unnest(${options}) AS option)`
}

/** SQL of a suffix of a line for the mode `mode` of a trigger or a rule that differs from the default `O`. */
function formatFiringMode(mode: string): string {
  return `CASE ${mode} WHEN 'D' THEN ' DISABLED' WHEN 'R' THEN ' ENABLE REPLICA' WHEN 'A' THEN ' ENABLE ALWAYS' END`
}

/**
 * Statement that describes the objects of the schema of `$1`, one line each, in the order of the bytes of the lines.
 *
 * - It describes what `pg_catalog` gives of tables, columns, constraints, indexes, views, sequences, types, functions, triggers, rules, policies, statistics, and collations, with the owners other than the role of `$2` and the privileges that differ from the default ones.
 * - The lines of columns do not tell their order, since PostgreSQL adds a column only at the end, so that a column that a rollback adds back matches.
 * - It leaves out the objects of extensions, which `createExtension` keeps on rollback, the objects that another object creates with itself, such as the array type of a type and the constructors of a range type, and the `NOT NULL` constraints of PostgreSQL 18, which the lines of columns show.
 * - It sorts the items of ACLs and options, whose order follows the order of their changes rather than what they grant or set.
 * - Names in definitions, such as of types and functions, depend on the search path, so lines compare only under one search path.
 */
const describeStatement = `
WITH
  namespace AS (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1),
  default_owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2),
  relation AS MATERIALIZED (
    SELECT class.* FROM pg_catalog.pg_class AS class
    WHERE class.relnamespace = (SELECT oid FROM namespace)
      AND class.relkind IN ('r', 'p', 'f', 'v', 'm', 'S', 'c')
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_depend
        WHERE classid = 'pg_catalog.pg_class'::regclass AND objid = class.oid AND deptype = 'e'
      )
      -- An extension owns the type of its composite type rather than its relation.
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_depend
        WHERE classid = 'pg_catalog.pg_type'::regclass AND objid = class.reltype AND deptype = 'e'
      )
  ),
  schema_type AS MATERIALIZED (
    SELECT type.* FROM pg_catalog.pg_type AS type
    WHERE type.typnamespace = (SELECT oid FROM namespace)
      AND type.typtype IN ('b', 'd', 'e', 'r')
      -- The array type of a type follows it.
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_type AS element WHERE element.typarray = type.oid)
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_depend
        WHERE classid = 'pg_catalog.pg_type'::regclass AND objid = type.oid AND deptype = 'e'
      )
  )
SELECT line FROM (
  SELECT concat(
    CASE relation.relkind
      WHEN 'f' THEN 'foreign table '
      WHEN 'v' THEN 'view '
      WHEN 'm' THEN 'materialized view '
      WHEN 'S' THEN 'sequence '
      WHEN 'c' THEN 'type '
      ELSE 'table '
    END,
    relation.relname,
    CASE WHEN relation.relkind = 'c' THEN ' COMPOSITE' END,
    CASE WHEN relation.relpersistence = 'u' THEN ' UNLOGGED' END,
    CASE WHEN relation.relkind = 'p' THEN ' PARTITION BY ' || pg_catalog.pg_get_partkeydef(relation.oid) END,
    (
      SELECT CASE WHEN relation.relispartition THEN ' PARTITION OF ' ELSE ' INHERITS ' END
        || string_agg(inheritance.inhparent::regclass::text, ', ' ORDER BY inheritance.inhseqno)
      FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhrelid = relation.oid
    ),
    CASE WHEN relation.relispartition THEN ' ' || pg_catalog.pg_get_expr(relation.relpartbound, relation.oid) END,
    (
      SELECT concat(' SERVER ', server.srvname, ' OPTIONS (' || ${sortOptions("foreign_table.ftoptions")} || ')')
      FROM pg_catalog.pg_foreign_table AS foreign_table
      JOIN pg_catalog.pg_foreign_server AS server ON server.oid = foreign_table.ftserver
      WHERE foreign_table.ftrelid = relation.oid
    ),
    (
      SELECT concat(
        ' AS ', pg_catalog.format_type(sequence.seqtypid, NULL),
        ' START ', sequence.seqstart, ' INCREMENT ', sequence.seqincrement,
        ' MINVALUE ', sequence.seqmin, ' MAXVALUE ', sequence.seqmax, ' CACHE ', sequence.seqcache,
        CASE WHEN sequence.seqcycle THEN ' CYCLE' END
      )
      FROM pg_catalog.pg_sequence AS sequence
      WHERE sequence.seqrelid = relation.oid
    ),
    (
      SELECT ' OWNED BY ' || owner.relname || '.' || owner_column.attname
      FROM pg_catalog.pg_depend AS dependency
      JOIN pg_catalog.pg_class AS owner ON owner.oid = dependency.refobjid
      JOIN pg_catalog.pg_attribute AS owner_column
        ON owner_column.attrelid = dependency.refobjid AND owner_column.attnum = dependency.refobjsubid
      WHERE relation.relkind = 'S'
        AND dependency.classid = 'pg_catalog.pg_class'::regclass AND dependency.objid = relation.oid
        AND dependency.refclassid = 'pg_catalog.pg_class'::regclass AND dependency.refobjsubid > 0
        AND dependency.deptype IN ('a', 'i')
    ),
    CASE WHEN relation.relkind IN ('v', 'm') THEN ' ' || ltrim(pg_catalog.pg_get_viewdef(relation.oid)) END,
    ' WITH (' || ${sortOptions("relation.reloptions")} || ')',
    CASE WHEN relation.relrowsecurity THEN ' ROW LEVEL SECURITY' END,
    CASE WHEN relation.relforcerowsecurity THEN ' FORCE ROW LEVEL SECURITY' END,
    CASE WHEN relation.relkind IN ('r', 'p') THEN
      CASE relation.relreplident
        WHEN 'f' THEN ' REPLICA IDENTITY FULL'
        WHEN 'n' THEN ' REPLICA IDENTITY NOTHING'
        WHEN 'i' THEN ' REPLICA IDENTITY USING INDEX ' || (
          SELECT index_class.relname
          FROM pg_catalog.pg_index AS index
          JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index.indexrelid
          WHERE index.indrelid = relation.oid AND index.indisreplident
        )
      END
    END,
    ${formatOwner("relation.relowner")},
    CASE
      WHEN relation.relkind = 'c' THEN (
        SELECT ${formatGrant("row_type.typacl", "'T'", "row_type.typowner")}
        FROM pg_catalog.pg_type AS row_type
        WHERE row_type.oid = relation.reltype
      )
      ELSE ${formatGrant(
        "relation.relacl",
        `(CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END)::"char"`,
        "relation.relowner",
      )}
    END
  ) AS line
  FROM relation
  UNION ALL
  SELECT concat(
    CASE WHEN relation.relkind = 'c' THEN 'attribute ' ELSE 'column ' END,
    relation.relname, '.', attribute.attname, ' ', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    CASE WHEN attribute.attcollation <> attribute_type.typcollation THEN ' COLLATE ' || attribute.attcollation::regcollation::text END,
    CASE WHEN attribute.attnotnull THEN ' NOT NULL' END,
    CASE attribute.attgenerated
      WHEN 's' THEN ' GENERATED ALWAYS AS (' || pg_catalog.pg_get_expr(def.adbin, def.adrelid) || ') STORED'
      WHEN 'v' THEN ' GENERATED ALWAYS AS (' || pg_catalog.pg_get_expr(def.adbin, def.adrelid) || ') VIRTUAL'
      ELSE ' DEFAULT ' || pg_catalog.pg_get_expr(def.adbin, def.adrelid)
    END,
    CASE attribute.attidentity
      WHEN 'a' THEN ' GENERATED ALWAYS AS IDENTITY'
      WHEN 'd' THEN ' GENERATED BY DEFAULT AS IDENTITY'
    END,
    CASE WHEN attribute.attstorage <> attribute_type.typstorage THEN
      CASE attribute.attstorage WHEN 'p' THEN ' STORAGE PLAIN' WHEN 'e' THEN ' STORAGE EXTERNAL' WHEN 'm' THEN ' STORAGE MAIN' ELSE ' STORAGE EXTENDED' END
    END,
    CASE attribute.attcompression WHEN 'p' THEN ' COMPRESSION pglz' WHEN 'l' THEN ' COMPRESSION lz4' END,
    -- The default target is NULL since PostgreSQL 17 and -1 before it.
    CASE WHEN attribute.attstattarget >= 0 THEN ' STATISTICS ' || attribute.attstattarget END,
    -- A column grants nothing of its own by default, whether its ACL is NULL or empty.
    ' GRANT ' || nullif(${sortAcl("attribute.attacl")}, '{}')
  )
  FROM relation
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
  JOIN pg_catalog.pg_type AS attribute_type ON attribute_type.oid = attribute.atttypid
  LEFT JOIN pg_catalog.pg_attrdef AS def ON def.adrelid = attribute.attrelid AND def.adnum = attribute.attnum
  WHERE relation.relkind <> 'S'
  UNION ALL
  SELECT concat('constraint ', relation.relname, '.', con.conname, ' ', pg_catalog.pg_get_constraintdef(con.oid))
  FROM relation
  JOIN pg_catalog.pg_constraint AS con ON con.conrelid = relation.oid
  WHERE con.contype <> 'n'
  UNION ALL
  SELECT 'index ' || pg_catalog.pg_get_indexdef(index.indexrelid)
  FROM relation
  JOIN pg_catalog.pg_index AS index ON index.indrelid = relation.oid
  UNION ALL
  SELECT concat(
    'type ', schema_type.typname,
    CASE schema_type.typtype
      WHEN 'e' THEN ' ENUM (' || coalesce((
        SELECT string_agg(quote_literal(label.enumlabel), ', ' ORDER BY label.enumsortorder)
        FROM pg_catalog.pg_enum AS label
        WHERE label.enumtypid = schema_type.oid
      ), '') || ')'
      WHEN 'd' THEN concat(
        ' DOMAIN ', pg_catalog.format_type(schema_type.typbasetype, schema_type.typtypmod),
        (
          SELECT ' COLLATE ' || schema_type.typcollation::regcollation::text
          FROM pg_catalog.pg_type AS base_type
          WHERE base_type.oid = schema_type.typbasetype AND schema_type.typcollation <> base_type.typcollation
        ),
        CASE WHEN schema_type.typnotnull THEN ' NOT NULL' END,
        ' DEFAULT ' || schema_type.typdefault
      )
      WHEN 'r' THEN (
        SELECT concat(
          ' RANGE (SUBTYPE = ', pg_catalog.format_type(range.rngsubtype, NULL),
          CASE WHEN range.rngcollation <> 0 THEN ', COLLATION = ' || range.rngcollation::regcollation::text END,
          CASE WHEN range.rngcanonical::oid <> 0 THEN ', CANONICAL = ' || range.rngcanonical::text END,
          CASE WHEN range.rngsubdiff::oid <> 0 THEN ', SUBTYPE_DIFF = ' || range.rngsubdiff::text END,
          ')'
        )
        FROM pg_catalog.pg_range AS range
        WHERE range.rngtypid = schema_type.oid
      )
      ELSE ' BASE'
    END,
    ${formatOwner("schema_type.typowner")},
    ${formatGrant("schema_type.typacl", "'T'", "schema_type.typowner")}
  )
  FROM schema_type
  UNION ALL
  SELECT concat('constraint ', schema_type.typname, '.', con.conname, ' ', pg_catalog.pg_get_constraintdef(con.oid))
  FROM schema_type
  JOIN pg_catalog.pg_constraint AS con ON con.contypid = schema_type.oid
  WHERE con.contype <> 'n'
  UNION ALL
  SELECT concat(
    CASE
      -- pg_get_functiondef rejects an aggregate.
      WHEN proc.prokind = 'a' THEN (
        SELECT concat(
          'aggregate ', proc.proname, '(', pg_catalog.pg_get_function_identity_arguments(proc.oid), ')',
          ' (SFUNC = ', aggregate.aggtransfn::text, ', STYPE = ', pg_catalog.format_type(aggregate.aggtranstype, NULL),
          CASE WHEN aggregate.aggfinalfn::oid <> 0 THEN ', FINALFUNC = ' || aggregate.aggfinalfn::text END,
          CASE WHEN aggregate.aggcombinefn::oid <> 0 THEN ', COMBINEFUNC = ' || aggregate.aggcombinefn::text END,
          ', INITCOND = ' || quote_literal(aggregate.agginitval),
          ')'
        )
        FROM pg_catalog.pg_aggregate AS aggregate
        WHERE aggregate.aggfnoid = proc.oid
      )
      ELSE 'function ' || rtrim(pg_catalog.pg_get_functiondef(proc.oid), E'\\n')
    END,
    ${formatOwner("proc.proowner")},
    ${formatGrant("proc.proacl", "'f'", "proc.proowner")}
  )
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.pronamespace = (SELECT oid FROM namespace)
    -- An internal dependency marks a function that an object creates with itself, such as the constructors of a range type.
    AND NOT EXISTS (
      SELECT FROM pg_catalog.pg_depend
      WHERE classid = 'pg_catalog.pg_proc'::regclass AND objid = proc.oid AND deptype IN ('e', 'i')
    )
  UNION ALL
  SELECT concat('trigger ', pg_catalog.pg_get_triggerdef(trigger.oid), ${formatFiringMode("trigger.tgenabled")})
  FROM relation
  JOIN pg_catalog.pg_trigger AS trigger ON trigger.tgrelid = relation.oid
  WHERE NOT trigger.tgisinternal
  UNION ALL
  SELECT concat('rule ', pg_catalog.pg_get_ruledef(rule.oid), ${formatFiringMode("rule.ev_enabled")})
  FROM relation
  JOIN pg_catalog.pg_rewrite AS rule ON rule.ev_class = relation.oid
  WHERE rule.rulename <> '_RETURN'
  UNION ALL
  SELECT concat(
    'policy ', relation.relname, '.', policy.polname,
    CASE WHEN policy.polpermissive THEN ' AS PERMISSIVE' ELSE ' AS RESTRICTIVE' END,
    ' FOR ', CASE policy.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
    ' TO ', (
      SELECT string_agg(role_name, ', ' ORDER BY role_name)
      FROM (
        SELECT CASE WHEN role_oid = 0 THEN 'public' ELSE role_oid::regrole::text END AS role_name
        FROM unnest(policy.polroles) AS role_oid
      ) AS roles
    ),
    ' USING (' || pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) || ')',
    ' WITH CHECK (' || pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) || ')'
  )
  FROM relation
  JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = relation.oid
  UNION ALL
  SELECT concat('statistics ', pg_catalog.pg_get_statisticsobjdef(statistics.oid), ${formatOwner("statistics.stxowner")})
  FROM pg_catalog.pg_statistic_ext AS statistics
  WHERE statistics.stxnamespace = (SELECT oid FROM namespace)
  UNION ALL
  -- The columns of pg_collation differ between versions of PostgreSQL, and JSON lists those of the running one.
  SELECT concat(
    'collation ', coll.collname, ' ',
    (to_jsonb(coll.*) - 'oid' - 'collname' - 'collnamespace' - 'collowner')::text,
    ${formatOwner("coll.collowner")}
  )
  FROM pg_catalog.pg_collation AS coll
  WHERE coll.collnamespace = (SELECT oid FROM namespace)
    AND NOT EXISTS (
      SELECT FROM pg_catalog.pg_depend
      WHERE classid = 'pg_catalog.pg_collation'::regclass AND objid = coll.oid AND deptype = 'e'
    )
) AS lines
ORDER BY line COLLATE "C"
`

/**
 * Describes the structure of PostgreSQL schema `schemaName` as lines of text, one for each object, such as a table, a column, or an index, in order.
 *
 * It names the owners of the objects other than role `ownerName`, which creates the objects of the schema, such as the role that verifies migrations, read before they run, since a migration may set another role.
 * Two descriptions of one schema compare as its structure only under one search path, since definitions qualify the names of the schemas that the search path lacks.
 * It leaves out the objects of extensions and the order of columns.
 */
export async function describeSchema(
  database: Database,
  schemaName: string,
  ownerName: string,
): Promise<string[]> {
  const { rows } = await database.execute({
    text: describeStatement,
    parameters: [schemaName, ownerName],
  })
  const lines: string[] = []
  for (const row of rows) {
    lines.push(row[0]!)
  }
  return lines
}
