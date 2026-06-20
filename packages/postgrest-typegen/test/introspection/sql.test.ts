import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SYSTEM_SCHEMAS,
  filterByList,
} from "../../src/introspection/sql/helpers.ts";
import { SCHEMAS_SQL } from "../../src/introspection/sql/schemas.sql.ts";
import { TABLES_SQL } from "../../src/introspection/sql/table.sql.ts";
import { FOREIGN_TABLES_SQL } from "../../src/introspection/sql/foreign_tables.sql.ts";
import { VIEWS_SQL } from "../../src/introspection/sql/views.sql.ts";
import { MATERIALIZED_VIEWS_SQL } from "../../src/introspection/sql/materialized_views.sql.ts";
import { COLUMNS_SQL } from "../../src/introspection/sql/columns.sql.ts";
import { FUNCTIONS_SQL } from "../../src/introspection/sql/functions.sql.ts";
import { TYPES_SQL } from "../../src/introspection/sql/types.sql.ts";
import { TABLE_RELATIONSHIPS_SQL } from "../../src/introspection/sql/table_relationships.sql.ts";
import { VIEWS_KEY_DEPENDENCIES_SQL } from "../../src/introspection/sql/views_key_dependencies.sql.ts";

/**
 * These tests pin the exact SQL the generator/introspection path builds. The
 * builders are ported verbatim from postgres-meta and parameterized; here we
 * exercise the single option combination `introspect()` (PGMETA-110) will use:
 *
 * - schemas/tables/views/columns/functions/relationships: system schemas
 *   excluded (`includeSystemSchemas: false`)
 * - foreign tables / materialized views: no default system-schema exclusion
 * - types: includeTableTypes + includeArrayTypes true, no schema filter
 *   (includeSystemSchemas: true)
 *
 * Snapshots double as a guard that the ported SQL stays byte-stable.
 */
describe("filterByList", () => {
  test("produces a NOT IN clause for the default system schemas", () => {
    expect(
      filterByList(undefined, undefined, DEFAULT_SYSTEM_SCHEMAS),
    ).toMatchInlineSnapshot(
      `"NOT IN ('information_schema','pg_catalog','pg_toast')"`,
    );
  });

  test("produces an IN clause for included schemas", () => {
    expect(
      filterByList(["public", "api"], undefined, DEFAULT_SYSTEM_SCHEMAS),
    ).toMatchInlineSnapshot(`"IN ('public','api')"`);
  });

  test("returns empty string when nothing to filter", () => {
    expect(filterByList(undefined, undefined, undefined)).toBe("");
  });
});

// The schema filter the generator path computes for the system-schema-excluding queries.
const schemaFilter = filterByList(undefined, undefined, DEFAULT_SYSTEM_SCHEMAS);

describe("introspection SQL builders (generator-path option combination)", () => {
  test("SCHEMAS_SQL", () => {
    expect(
      SCHEMAS_SQL({ includeSystemSchemas: false, nameFilter: schemaFilter }),
    ).toMatchInlineSnapshot(`
        "
        -- Adapted from information_schema.schemata
        select
          n.oid::int8 as id,
          n.nspname as name,
          u.rolname as owner
        from
          pg_namespace n,
          pg_roles u
        where
          n.nspowner = u.oid
          
          and n.nspname NOT IN ('information_schema','pg_catalog','pg_toast')
          and not pg_catalog.starts_with(n.nspname, 'pg_')
          and (
            pg_has_role(n.nspowner, 'USAGE')
            or has_schema_privilege(n.oid, 'CREATE, USAGE')
          )
          and not pg_catalog.starts_with(n.nspname, 'pg_temp_')
          and not pg_catalog.starts_with(n.nspname, 'pg_toast_temp_')


        "
      `);
  });

  test("TABLES_SQL", () => {
    expect(TABLES_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      SELECT
        c.oid :: int8 AS id,
        nc.nspname AS schema,
        c.relname AS name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        CASE
          WHEN c.relreplident = 'd' THEN 'DEFAULT'
          WHEN c.relreplident = 'i' THEN 'INDEX'
          WHEN c.relreplident = 'f' THEN 'FULL'
          ELSE 'NOTHING'
        END AS replica_identity,
        pg_total_relation_size(format('%I.%I', nc.nspname, c.relname)) :: int8 AS bytes,
        pg_size_pretty(
          pg_total_relation_size(format('%I.%I', nc.nspname, c.relname))
        ) AS size,
        pg_stat_get_live_tuples(c.oid) AS live_rows_estimate,
        pg_stat_get_dead_tuples(c.oid) AS dead_rows_estimate,
        obj_description(c.oid) AS comment
      FROM
        pg_namespace nc
        JOIN pg_class c ON nc.oid = c.relnamespace
      WHERE
        nc.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND
        
        
        c.relkind IN ('r', 'p')
        AND NOT pg_is_other_temp_schema(nc.oid)
        AND (
          pg_has_role(c.relowner, 'USAGE')
          OR has_table_privilege(
            c.oid,
            'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
          )
          OR has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        )


      "
    `);
  });

  test("FOREIGN_TABLES_SQL", () => {
    // foreign tables use filterByList(included, excluded) with no default exclude
    expect(FOREIGN_TABLES_SQL({ schemaFilter: "" })).toMatchInlineSnapshot(`
      "
      SELECT
        c.oid :: int8 AS id,
        n.nspname AS schema,
        c.relname AS name,
        obj_description(c.oid) AS comment
      FROM
        pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE
        
        
        
        c.relkind = 'f'


      "
    `);
  });

  test("VIEWS_SQL", () => {
    expect(VIEWS_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      SELECT
        c.oid :: int8 AS id,
        n.nspname AS schema,
        c.relname AS name,
        -- See definition of information_schema.views
        (pg_relation_is_updatable(c.oid, false) & 20) = 20 AS is_updatable,
        obj_description(c.oid) AS comment
      FROM
        pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE
        n.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND
        
        
        c.relkind = 'v'


      "
    `);
  });

  test("MATERIALIZED_VIEWS_SQL", () => {
    // materialized views use filterByList(included, excluded, undefined)
    expect(MATERIALIZED_VIEWS_SQL({ schemaFilter: "" })).toMatchInlineSnapshot(`
      "
      select
        c.oid::int8 as id,
        n.nspname as schema,
        c.relname as name,
        c.relispopulated as is_populated,
        obj_description(c.oid) as comment
      from
        pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where
        
        
        
        c.relkind = 'm'


      "
    `);
  });

  test("COLUMNS_SQL", () => {
    expect(COLUMNS_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      -- Adapted from information_schema.columns

      SELECT
        c.oid :: int8 AS table_id,
        nc.nspname AS schema,
        c.relname AS table,
        (c.oid || '.' || a.attnum) AS id,
        a.attnum AS ordinal_position,
        a.attname AS name,
        CASE
          WHEN a.atthasdef THEN pg_get_expr(ad.adbin, ad.adrelid)
          ELSE NULL
        END AS default_value,
        CASE
          WHEN t.typtype = 'd' THEN CASE
            WHEN bt.typelem <> 0 :: oid
            AND bt.typlen = -1 THEN 'ARRAY'
            WHEN nbt.nspname = 'pg_catalog' THEN format_type(t.typbasetype, NULL)
            ELSE 'USER-DEFINED'
          END
          ELSE CASE
            WHEN t.typelem <> 0 :: oid
            AND t.typlen = -1 THEN 'ARRAY'
            WHEN nt.nspname = 'pg_catalog' THEN format_type(a.atttypid, NULL)
            ELSE 'USER-DEFINED'
          END
        END AS data_type,
        COALESCE(bt.typname, t.typname) AS format,
        a.attidentity IN ('a', 'd') AS is_identity,
        CASE
          a.attidentity
          WHEN 'a' THEN 'ALWAYS'
          WHEN 'd' THEN 'BY DEFAULT'
          ELSE NULL
        END AS identity_generation,
        a.attgenerated IN ('s') AS is_generated,
        NOT (
          a.attnotnull
          OR t.typtype = 'd' AND t.typnotnull
        ) AS is_nullable,
        (
          c.relkind IN ('r', 'p')
          OR c.relkind IN ('v', 'f') AND pg_column_is_updatable(c.oid, a.attnum, FALSE)
        ) AS is_updatable,
        uniques.table_id IS NOT NULL AS is_unique,
        check_constraints.definition AS "check",
        array_to_json(
          array(
            SELECT
              enumlabel
            FROM
              pg_catalog.pg_enum enums
            WHERE
              enums.enumtypid = coalesce(bt.oid, t.oid)
              OR enums.enumtypid = coalesce(bt.typelem, t.typelem)
            ORDER BY
              enums.enumsortorder
          )
        ) AS enums,
        col_description(c.oid, a.attnum) AS comment
      FROM
        pg_attribute a
        LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid
        AND a.attnum = ad.adnum
        JOIN (
          pg_class c
          JOIN pg_namespace nc ON c.relnamespace = nc.oid
        ) ON a.attrelid = c.oid
        JOIN (
          pg_type t
          JOIN pg_namespace nt ON t.typnamespace = nt.oid
        ) ON a.atttypid = t.oid
        LEFT JOIN (
          pg_type bt
          JOIN pg_namespace nbt ON bt.typnamespace = nbt.oid
        ) ON t.typtype = 'd'
        AND t.typbasetype = bt.oid
        LEFT JOIN (
          SELECT DISTINCT ON (table_id, ordinal_position)
            conrelid AS table_id,
            conkey[1] AS ordinal_position
          FROM pg_catalog.pg_constraint
          WHERE contype = 'u' AND cardinality(conkey) = 1
        ) AS uniques ON uniques.table_id = c.oid AND uniques.ordinal_position = a.attnum
        LEFT JOIN (
          -- We only select the first column check
          SELECT DISTINCT ON (table_id, ordinal_position)
            conrelid AS table_id,
            conkey[1] AS ordinal_position,
            substring(
              pg_get_constraintdef(pg_constraint.oid, true),
              8,
              length(pg_get_constraintdef(pg_constraint.oid, true)) - 8
            ) AS "definition"
          FROM pg_constraint
          WHERE contype = 'c' AND cardinality(conkey) = 1
          ORDER BY table_id, ordinal_position, oid asc
        ) AS check_constraints ON check_constraints.table_id = c.oid AND check_constraints.ordinal_position = a.attnum
      WHERE
        nc.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND
        
        
        
        
        NOT pg_is_other_temp_schema(nc.oid)
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (c.relkind IN ('r', 'v', 'm', 'f', 'p'))
        AND (
          pg_has_role(c.relowner, 'USAGE')
          OR has_column_privilege(
            c.oid,
            a.attnum,
            'SELECT, INSERT, UPDATE, REFERENCES'
          )
        )


      "
    `);
  });

  test("FUNCTIONS_SQL", () => {
    expect(FUNCTIONS_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      -- CTE with sane arg_modes, arg_names, and arg_types.
      -- All three are always of the same length.
      -- All three include all args, including OUT and TABLE args.
      with functions as (
        select
          p.*,
          -- proargmodes is null when all arg modes are IN
          coalesce(
            p.proargmodes,
            array_fill('i'::text, array[cardinality(coalesce(p.proallargtypes, p.proargtypes))])
          ) as arg_modes,
          -- proargnames is null when all args are unnamed
          coalesce(
            p.proargnames,
            array_fill(''::text, array[cardinality(coalesce(p.proallargtypes, p.proargtypes))])
          ) as arg_names,
          -- proallargtypes is null when all arg modes are IN
          coalesce(p.proallargtypes, p.proargtypes) as arg_types,
          array_cat(
            array_fill(false, array[pronargs - pronargdefaults]),
            array_fill(true, array[pronargdefaults])) as arg_has_defaults
        from
          pg_proc as p
          join pg_namespace n on p.pronamespace = n.oid
        where
          n.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND
          
          
          
          p.prokind = 'f'
      )
      select
        f.oid::int8 as id,
        n.nspname as schema,
        f.proname as name,
        l.lanname as language,
        case
          when l.lanname = 'internal' then ''
          else f.prosrc
        end as definition,
        case
          when l.lanname = 'internal' then f.prosrc
          else pg_get_functiondef(f.oid)
        end as complete_statement,
        coalesce(f_args.args, '[]') as args,
        pg_get_function_arguments(f.oid) as argument_types,
        pg_get_function_identity_arguments(f.oid) as identity_argument_types,
        f.prorettype::int8 as return_type_id,
        pg_get_function_result(f.oid) as return_type,
        nullif(rt.typrelid::int8, 0) as return_type_relation_id,
        f.proretset as is_set_returning_function,
        case
          when f.proretset then nullif(f.prorows, 0)
          else null
        end as prorows,
        case
          when f.provolatile = 'i' then 'IMMUTABLE'
          when f.provolatile = 's' then 'STABLE'
          when f.provolatile = 'v' then 'VOLATILE'
        end as behavior,
        f.prosecdef as security_definer,
        f_config.config_params as config_params
      from
        functions f
        left join pg_namespace n on f.pronamespace = n.oid
        left join pg_language l on f.prolang = l.oid
        left join pg_type rt on rt.oid = f.prorettype
        left join (
          select
            oid,
            jsonb_object_agg(param, value) filter (where param is not null) as config_params
          from
            (
              select
                oid,
                (string_to_array(unnest(proconfig), '='))[1] as param,
                (string_to_array(unnest(proconfig), '='))[2] as value
              from
                functions
            ) as t
          group by
            oid
        ) f_config on f_config.oid = f.oid
        left join (
          select
            oid,
            jsonb_agg(jsonb_build_object(
              'mode', t2.mode,
              'name', name,
              'type_id', type_id,
              'has_default', has_default
            )) as args
          from
            (
              select
                oid,
                unnest(arg_modes) as mode,
                unnest(arg_names) as name,
                unnest(arg_types)::int8 as type_id,
                unnest(arg_has_defaults) as has_default
              from
                functions
            ) as t1,
            lateral (
              select
                case
                  when t1.mode = 'i' then 'in'
                  when t1.mode = 'o' then 'out'
                  when t1.mode = 'b' then 'inout'
                  when t1.mode = 'v' then 'variadic'
                  else 'table'
                end as mode
            ) as t2
          group by
            t1.oid
        ) f_args on f_args.oid = f.oid


      "
    `);
  });

  test("TYPES_SQL", () => {
    expect(
      TYPES_SQL({
        schemaFilter: "",
        includeTableTypes: true,
        includeArrayTypes: true,
      }),
    ).toMatchInlineSnapshot(`
        "
        select
          t.oid::int8 as id,
          t.typname as name,
          n.nspname as schema,
          format_type (t.oid, null) as format,
          coalesce(t_enums.enums, '[]') as enums,
          coalesce(t_attributes.attributes, '[]') as attributes,
          obj_description (t.oid, 'pg_type') as comment,
          nullif(t.typrelid::int8, 0) as type_relation_id
        from
          pg_type t
          left join pg_namespace n on n.oid = t.typnamespace
          left join (
            select
              enumtypid,
              jsonb_agg(enumlabel order by enumsortorder) as enums
            from
              pg_enum
            group by
              enumtypid
          ) as t_enums on t_enums.enumtypid = t.oid
          left join (
            select
              oid,
              jsonb_agg(
                jsonb_build_object('name', a.attname, 'type_id', a.atttypid::int8)
                order by a.attnum asc
              ) as attributes
            from
              pg_class c
              join pg_attribute a on a.attrelid = c.oid
            where
              c.relkind = 'c' and not a.attisdropped
            group by
              c.oid
          ) as t_attributes on t_attributes.oid = t.typrelid
          where
              (
                t.typrelid = 0
                or (
                  select
                    c.relkind in ('c', 'r', 'v', 'm', 'p')
                  from
                    pg_class c
                  where
                    c.oid = t.typrelid
                )
              )
              
              
              


        "
      `);
  });

  test("TABLE_RELATIONSHIPS_SQL", () => {
    expect(TABLE_RELATIONSHIPS_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      -- Adapted from
      -- https://github.com/PostgREST/postgrest/blob/f9f0f79fa914ac00c11fbf7f4c558e14821e67e2/src/PostgREST/SchemaCache.hs#L722
      WITH
      pks_uniques_cols AS (
        SELECT
          connamespace,
          conrelid,
          jsonb_agg(column_info.cols) as cols
        FROM pg_constraint
        JOIN lateral (
          SELECT array_agg(cols.attname order by cols.attnum) as cols
          FROM ( select unnest(conkey) as col) _
          JOIN pg_attribute cols on cols.attrelid = conrelid and cols.attnum = col
        ) column_info ON TRUE
        WHERE
          contype IN ('p', 'u') and
          connamespace::regnamespace::text <> 'pg_catalog'
          and connamespace::regnamespace::text NOT IN ('information_schema','pg_catalog','pg_toast')
        GROUP BY connamespace, conrelid
      )
      SELECT
        traint.conname AS foreign_key_name,
        ns1.nspname AS schema,
        tab.relname AS relation,
        column_info.cols AS columns,
        ns2.nspname AS referenced_schema,
        other.relname AS referenced_relation,
        column_info.refs AS referenced_columns,
        (column_info.cols IN (SELECT * FROM jsonb_array_elements(pks_uqs.cols))) AS is_one_to_one
      FROM pg_constraint traint
      JOIN LATERAL (
        SELECT
          jsonb_agg(cols.attname order by ord) AS cols,
          jsonb_agg(refs.attname order by ord) AS refs
        FROM unnest(traint.conkey, traint.confkey) WITH ORDINALITY AS _(col, ref, ord)
        JOIN pg_attribute cols ON cols.attrelid = traint.conrelid AND cols.attnum = col
        JOIN pg_attribute refs ON refs.attrelid = traint.confrelid AND refs.attnum = ref
        WHERE traint.connamespace::regnamespace::text NOT IN ('information_schema','pg_catalog','pg_toast')
      ) AS column_info ON TRUE
      JOIN pg_namespace ns1 ON ns1.oid = traint.connamespace
      JOIN pg_class tab ON tab.oid = traint.conrelid
      JOIN pg_class other ON other.oid = traint.confrelid
      JOIN pg_namespace ns2 ON ns2.oid = other.relnamespace
      LEFT JOIN pks_uniques_cols pks_uqs ON pks_uqs.connamespace = traint.connamespace AND pks_uqs.conrelid = traint.conrelid
      WHERE traint.contype = 'f'
      AND traint.conparentid = 0
      and ns1.nspname NOT IN ('information_schema','pg_catalog','pg_toast')
      "
    `);
  });

  test("VIEWS_KEY_DEPENDENCIES_SQL", () => {
    expect(VIEWS_KEY_DEPENDENCIES_SQL({ schemaFilter })).toMatchInlineSnapshot(`
      "
      -- Adapted from
      -- https://github.com/PostgREST/postgrest/blob/f9f0f79fa914ac00c11fbf7f4c558e14821e67e2/src/PostgREST/SchemaCache.hs#L820
      with recursive
      pks_fks as (
        -- pk + fk referencing col
        select
          contype::text as contype,
          conname,
          array_length(conkey, 1) as ncol,
          conrelid as resorigtbl,
          col as resorigcol,
          ord
        from pg_constraint
        left join lateral unnest(conkey) with ordinality as _(col, ord) on true
        where contype IN ('p', 'f')
        union
        -- fk referenced col
        select
          concat(contype, '_ref') as contype,
          conname,
          array_length(confkey, 1) as ncol,
          confrelid,
          col,
          ord
        from pg_constraint
        left join lateral unnest(confkey) with ordinality as _(col, ord) on true
        where contype='f'
        and connamespace::regnamespace::text NOT IN ('information_schema','pg_catalog','pg_toast')
      ),
      views as (
        select
          c.oid       as view_id,
          n.nspname   as view_schema,
          c.relname   as view_name,
          r.ev_action as view_definition
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_rewrite r on r.ev_class = c.oid
        where c.relkind in ('v', 'm') 
          and n.nspname NOT IN ('information_schema','pg_catalog','pg_toast')
      ),
      transform_json as (
        select
          view_id, view_schema, view_name,
          -- the following formatting is without indentation on purpose
          -- to allow simple diffs, with less whitespace noise
          replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            regexp_replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
            replace(
              view_definition::text,
            -- This conversion to json is heavily optimized for performance.
            -- The general idea is to use as few regexp_replace() calls as possible.
            -- Simple replace() is a lot faster, so we jump through some hoops
            -- to be able to use regexp_replace() only once.
            -- This has been tested against a huge schema with 250+ different views.
            -- The unit tests do NOT reflect all possible inputs. Be careful when changing this!
            -- -----------------------------------------------
            -- pattern           | replacement         | flags
            -- -----------------------------------------------
            -- <> in pg_node_tree is the same as null in JSON, but due to very poor performance of json_typeof
            -- we need to make this an empty array here to prevent json_array_elements from throwing an error
            -- when the targetList is null.
            -- We'll need to put it first, to make the node protection below work for node lists that start with
            -- null: (<> ..., too. This is the case for coldefexprs, when the first column does not have a default value.
               '<>'              , '()'
            -- , is not part of the pg_node_tree format, but used in the regex.
            -- This removes all , that might be part of column names.
            ), ','               , ''
            -- The same applies for { and }, although those are used a lot in pg_node_tree.
            -- We remove the escaped ones, which might be part of column names again.
            ), E'\\\\{'            , ''
            ), E'\\\\}'            , ''
            -- The fields we need are formatted as json manually to protect them from the regex.
            ), ' :targetList '   , ',"targetList":'
            ), ' :resno '        , ',"resno":'
            ), ' :resorigtbl '   , ',"resorigtbl":'
            ), ' :resorigcol '   , ',"resorigcol":'
            -- Make the regex also match the node type, e.g. \`{QUERY ...\`, to remove it in one pass.
            ), '{'               , '{ :'
            -- Protect node lists, which start with \`({\` or \`((\` from the greedy regex.
            -- The extra \`{\` is removed again later.
            ), '(('              , '{(('
            ), '({'              , '{({'
            -- This regex removes all unused fields to avoid the need to format all of them correctly.
            -- This leads to a smaller json result as well.
            -- Removal stops at \`,\` for used fields (see above) and \`}\` for the end of the current node.
            -- Nesting can't be parsed correctly with a regex, so we stop at \`{\` as well and
            -- add an empty key for the followig node.
            ), ' :[^}{,]+'       , ',"":'              , 'g'
            -- For performance, the regex also added those empty keys when hitting a \`,\` or \`}\`.
            -- Those are removed next.
            ), ',"":}'           , '}'
            ), ',"":,'           , ','
            -- This reverses the "node list protection" from above.
            ), '{('              , '('
            -- Every key above has been added with a \`,\` so far. The first key in an object doesn't need it.
            ), '{,'              , '{'
            -- pg_node_tree has \`()\` around lists, but JSON uses \`[]\`
            ), '('               , '['
            ), ')'               , ']'
            -- pg_node_tree has \` \` between list items, but JSON uses \`,\`
            ), ' '             , ','
          )::json as view_definition
        from views
      ),
      target_entries as(
        select
          view_id, view_schema, view_name,
          json_array_elements(view_definition->0->'targetList') as entry
        from transform_json
      ),
      results as(
        select
          view_id, view_schema, view_name,
          (entry->>'resno')::int as view_column,
          (entry->>'resorigtbl')::oid as resorigtbl,
          (entry->>'resorigcol')::int as resorigcol
        from target_entries
      ),
      -- CYCLE detection according to PG docs: https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CYCLE
      -- Can be replaced with CYCLE clause once PG v13 is EOL.
      recursion(view_id, view_schema, view_name, view_column, resorigtbl, resorigcol, is_cycle, path) as(
        select
          r.*,
          false,
          ARRAY[resorigtbl]
        from results r
        where view_schema NOT IN ('information_schema','pg_catalog','pg_toast')
        union all
        select
          view.view_id,
          view.view_schema,
          view.view_name,
          view.view_column,
          tab.resorigtbl,
          tab.resorigcol,
          tab.resorigtbl = ANY(path),
          path || tab.resorigtbl
        from recursion view
        join results tab on view.resorigtbl=tab.view_id and view.resorigcol=tab.view_column
        where not is_cycle
      ),
      repeated_references as(
        select
          view_id,
          view_schema,
          view_name,
          resorigtbl,
          resorigcol,
          array_agg(attname) as view_columns
        from recursion
        join pg_attribute vcol on vcol.attrelid = view_id and vcol.attnum = view_column
        group by
          view_id,
          view_schema,
          view_name,
          resorigtbl,
          resorigcol
      )
      select
        sch.nspname as table_schema,
        tbl.relname as table_name,
        rep.view_schema,
        rep.view_name,
        pks_fks.conname as constraint_name,
        pks_fks.contype as constraint_type,
        jsonb_agg(
          jsonb_build_object('table_column', col.attname, 'view_columns', view_columns) order by pks_fks.ord
        ) as column_dependencies
      from repeated_references rep
      join pks_fks using (resorigtbl, resorigcol)
      join pg_class tbl on tbl.oid = rep.resorigtbl
      join pg_attribute col on col.attrelid = tbl.oid and col.attnum = rep.resorigcol
      join pg_namespace sch on sch.oid = tbl.relnamespace
      group by sch.nspname, tbl.relname,  rep.view_schema, rep.view_name, pks_fks.conname, pks_fks.contype, pks_fks.ncol
      -- make sure we only return key for which all columns are referenced in the view - no partial PKs or FKs
      having ncol = array_length(array_agg(row(col.attname, view_columns) order by pks_fks.ord), 1)
      "
    `);
  });
});
