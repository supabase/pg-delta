import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("stress tests", () => {
  test("recursive CTE view with dollar identifiers and window functions", () => {
    const sql = `CREATE OR REPLACE VIEW public."User-Stats (v2)" AS
/* This comment contains ;;; and 'quotes' and $dollar$ */
WITH RECURSIVE "cte$levels" AS (
    SELECT
        u.id,
        u.parent_id,
        0        AS depth,
        ARRAY[u.id] AS path
    FROM public."user" u
    WHERE u.parent_id IS NULL

    UNION ALL

    SELECT
        c.id,
        c.parent_id,
        p.depth + 1,
        p.path || c.id
    FROM public."user"        c
    JOIN "cte$levels"         p
      ON p.id = c.parent_id
     AND c.id <> ALL(p.path) -- prevent cycles
),
json_expanded AS (
    SELECT
        u.id,
        jsonb_each_text(
            COALESCE(
                u.metadata,
                '{}'::jsonb
            )
        ) AS kv
    FROM public."user" u
)
SELECT
    l.id                                        AS "userId",
    l.depth                                     AS "level",
    COUNT(*) FILTER (WHERE e.kv.key = 'role')  AS "role_count",
    MAX(
        CASE
            WHEN e.kv.key = 'last_login'
            THEN e.kv.value::timestamptz
            ELSE NULL
        END
    ) OVER (PARTITION BY l.id)                  AS "lastLogin",
    string_agg(
        DISTINCT
        format(
            'key="%s"; value="%s"',
            replace(e.kv.key,   '"', '\\"'),
            replace(e.kv.value, '"', '\\"')
        ),
        E'\\n---\\n'
        ORDER BY e.kv.key
    )                                           AS "kv_dump",
    now() AT TIME ZONE 'UTC'                    AS "computed_at"
FROM "cte$levels" l
LEFT JOIN json_expanded e
       ON e.id = l.id
GROUP BY
    l.id,
    l.depth
HAVING
    COUNT(*) > 0
ORDER BY
    l.depth DESC,
    "userId";`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE OR REPLACE VIEW public."User-Stats (v2)" AS
      /* This comment contains ;;; and 'quotes' and $dollar$ */
      WITH RECURSIVE "cte$levels" AS (
          SELECT
              u.id,
              u.parent_id,
              0        AS depth,
              ARRAY[u.id] AS path
          FROM public."user" u
          WHERE u.parent_id IS NULL

          UNION ALL

          SELECT
              c.id,
              c.parent_id,
              p.depth + 1,
              p.path || c.id
          FROM public."user"        c
          JOIN "cte$levels"         p
            ON p.id = c.parent_id
           AND c.id <> ALL(p.path) -- prevent cycles
      ),
      json_expanded AS (
          SELECT
              u.id,
              jsonb_each_text(
                  COALESCE(
                      u.metadata,
                      '{}'::jsonb
                  )
              ) AS kv
          FROM public."user" u
      )
      SELECT
          l.id                                        AS "userId",
          l.depth                                     AS "level",
          COUNT(*) FILTER (WHERE e.kv.key = 'role')  AS "role_count",
          MAX(
              CASE
                  WHEN e.kv.key = 'last_login'
                  THEN e.kv.value::timestamptz
                  ELSE NULL
              END
          ) OVER (PARTITION BY l.id)                  AS "lastLogin",
          string_agg(
              DISTINCT
              format(
                  'key="%s"; value="%s"',
                  replace(e.kv.key,   '"', '\\"'),
                  replace(e.kv.value, '"', '\\"')
              ),
              E'\\n---\\n'
              ORDER BY e.kv.key
          )                                           AS "kv_dump",
          now() AT TIME ZONE 'UTC'                    AS "computed_at"
      FROM "cte$levels" l
      LEFT JOIN json_expanded e
             ON e.id = l.id
      GROUP BY
          l.id,
          l.depth
      HAVING
          COUNT(*) > 0
      ORDER BY
          l.depth DESC,
          "userId""
    `);
  });

  test("function with IN/OUT params, SECURITY DEFINER, SET, and nested dollar quoting", () => {
    const sql = `CREATE OR REPLACE FUNCTION public."compute""Stats$Weird"(
      IN p_user_id     uuid,
         IN     p_opts   jsonb     DEFAULT  '{"debug": false, "limit": 10}',
           OUT result   jsonb
)
   RETURNS jsonb
LANGUAGE    plpgsql VOLATILE SECURITY   DEFINER
SET search_path =
public, pg_temp
AS $func$
DECLARE
    v_sql        text;
    v_limit      integer := COALESCE((p_opts ->> 'limit')::int, 10);
    v_debug      boolean := (p_opts ->> 'debug')::boolean;
    v_row        record;
    v_payload    jsonb := '{}'::jsonb;
BEGIN
    v_sql := format($sql$
        SELECT
            u.id,
            u.email,
            jsonb_build_object(
                'roles',   array_agg(DISTINCT r.name ORDER BY r.name),
                'created', u.created_at,
                'note',    'This string contains ''quotes'', $dollars$, and ; semicolons'
            ) AS payload
        FROM public."user" u
        LEFT JOIN public.user_role ur ON ur.user_id = u.id
        LEFT JOIN public."role" r     ON r.id = ur.role_id
        WHERE u.id = %L
        GROUP BY u.id, u.email, u.created_at
        LIMIT %s
    $sql$, p_user_id, v_limit);

    IF v_debug THEN
        RAISE NOTICE E'Executing SQL:\\n%s', v_sql;
    END IF;

    FOR v_row IN EXECUTE v_sql
    LOOP
        v_payload :=
            v_payload
            || jsonb_build_object(
                v_row.email,
                jsonb_set(
                    v_row.payload,
                    '{computed_at}',
                    to_jsonb(clock_timestamp()),
                    true
                )
            );
    END LOOP;

    result := jsonb_build_object(
        'user_id', p_user_id,
        'data',    v_payload,
        'meta',    jsonb_build_object(
            'opts',        p_opts,
            'row_count',   jsonb_array_length(
                               COALESCE(
                                   jsonb_path_query_array(
                                       v_payload,
                                       '$.*'
                                   ),
                                   '[]'::jsonb
                               )
                           )
        )
    );

    RETURN;
EXCEPTION
    WHEN division_by_zero OR undefined_function THEN
        -- Totally unrelated exception, just to mess with parsers
        result := jsonb_build_object(
            'error', SQLERRM,
            'state', SQLSTATE
        );
        RETURN;
END;
$func$;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE OR REPLACE FUNCTION public."compute""Stats$Weird" (
        IN  p_user_id     uuid,
        IN  p_opts   jsonb     DEFAULT  '{"debug": false, "limit": 10}',
        OUT result   jsonb
      )
        RETURNS jsonb
        LANGUAGE    plpgsql
        VOLATILE
        SECURITY   DEFINER
        SET search_path =
      public, pg_temp
        AS $func$
      DECLARE
          v_sql        text;
          v_limit      integer := COALESCE((p_opts ->> 'limit')::int, 10);
          v_debug      boolean := (p_opts ->> 'debug')::boolean;
          v_row        record;
          v_payload    jsonb := '{}'::jsonb;
      BEGIN
          v_sql := format($sql$
              SELECT
                  u.id,
                  u.email,
                  jsonb_build_object(
                      'roles',   array_agg(DISTINCT r.name ORDER BY r.name),
                      'created', u.created_at,
                      'note',    'This string contains ''quotes'', $dollars$, and ; semicolons'
                  ) AS payload
              FROM public."user" u
              LEFT JOIN public.user_role ur ON ur.user_id = u.id
              LEFT JOIN public."role" r     ON r.id = ur.role_id
              WHERE u.id = %L
              GROUP BY u.id, u.email, u.created_at
              LIMIT %s
          $sql$, p_user_id, v_limit);

          IF v_debug THEN
              RAISE NOTICE E'Executing SQL:\\n%s', v_sql;
          END IF;

          FOR v_row IN EXECUTE v_sql
          LOOP
              v_payload :=
                  v_payload
                  || jsonb_build_object(
                      v_row.email,
                      jsonb_set(
                          v_row.payload,
                          '{computed_at}',
                          to_jsonb(clock_timestamp()),
                          true
                      )
                  );
          END LOOP;

          result := jsonb_build_object(
              'user_id', p_user_id,
              'data',    v_payload,
              'meta',    jsonb_build_object(
                  'opts',        p_opts,
                  'row_count',   jsonb_array_length(
                                     COALESCE(
                                         jsonb_path_query_array(
                                             v_payload,
                                             '$.*'
                                         ),
                                         '[]'::jsonb
                                     )
                                 )
              )
          );

          RETURN;
      EXCEPTION
          WHEN division_by_zero OR undefined_function THEN
              -- Totally unrelated exception, just to mess with parsers
              result := jsonb_build_object(
                  'error', SQLERRM,
                  'state', SQLSTATE
              );
              RETURN;
      END;
      $func$"
    `);
  });

  test("view with reserved word name, jsonb operators, CROSS JOIN LATERAL, WITH ORDINALITY", () => {
    const sql = `CREATE VIEW public."select" AS
SELECT
    t."from"::text COLLATE "C"              AS "from_text",
    t.val #>> '{a,b,c}'                     AS deep_value,
    t.val ?& ARRAY['x', 'y', 'z']           AS has_all_keys,
    t.val @> '{"nested": [1,2,3]}'::jsonb   AS contains_array,
    ln.ordinality                           AS idx,
    ln.elem                                 AS elem,
    /* comment mid-expression */
    (ln.elem::numeric / NULLIF(t.divisor, 0))::numeric(10,2) AS ratio
FROM (
    SELECT
        42                 AS "from",
        '{"a":{"b":{"c":"ok"}},"x":1}'::jsonb AS val,
        0                  AS divisor
) t
CROSS JOIN LATERAL jsonb_array_elements_text(
    '[ "1", "2", "3" ]'::jsonb
) WITH ORDINALITY AS ln(elem, ordinality)
WHERE
      t.val IS NOT NULL
  AND (
        ln.elem SIMILAR TO '[0-9]+'
        OR ln.elem ~* E'^[a-z]+'
      )
ORDER BY
    idx DESC NULLS LAST;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE VIEW public."select" AS
      SELECT
          t."from"::text COLLATE "C"              AS "from_text",
          t.val #>> '{a,b,c}'                     AS deep_value,
          t.val ?& ARRAY['x', 'y', 'z']           AS has_all_keys,
          t.val @> '{"nested": [1,2,3]}'::jsonb   AS contains_array,
          ln.ordinality                           AS idx,
          ln.elem                                 AS elem,
          /* comment mid-expression */
          (ln.elem::numeric / NULLIF(t.divisor, 0))::numeric(10,2) AS ratio
      FROM (
          SELECT
              42                 AS "from",
              '{"a":{"b":{"c":"ok"}},"x":1}'::jsonb AS val,
              0                  AS divisor
      ) t
      CROSS JOIN LATERAL jsonb_array_elements_text(
          '[ "1", "2", "3" ]'::jsonb
      ) WITH ORDINALITY AS ln(elem, ordinality)
      WHERE
            t.val IS NOT NULL
        AND (
              ln.elem SIMILAR TO '[0-9]+'
              OR ln.elem ~* E'^[a-z]+'
            )
      ORDER BY
          idx DESC NULLS LAST"
    `);
  });

  test("function with OUT params, RETURNS SETOF RECORD, RAISE EXCEPTION USING", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.get_everything_weird(
      p_input text,
          OUT    a int,
            OUT b text,
               OUT          c timestamptz
)
RETURNS SETOF RECORD
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        generate_series(1, length(p_input))     AS a,
        substr(p_input, 1, generate_series)     AS b,
        now() + (generate_series || ' seconds')::interval
    FROM generate_series(1, length(p_input));

    -- unreachable but legal
    IF false THEN
        RAISE EXCEPTION USING
            MESSAGE = 'never happens',
            DETAIL  = format('input=%L', p_input),
            HINT    = 'this is just here to hurt';
    END IF;
END;
$$;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE OR REPLACE FUNCTION public.get_everything_weird (
        p_input text,
        OUT     a int,
        OUT     b text,
        OUT     c timestamptz
      )
        RETURNS SETOF RECORD
        LANGUAGE plpgsql
        AS $$
      BEGIN
          RETURN QUERY
          SELECT
              generate_series(1, length(p_input))     AS a,
              substr(p_input, 1, generate_series)     AS b,
              now() + (generate_series || ' seconds')::interval
          FROM generate_series(1, length(p_input));

          -- unreachable but legal
          IF false THEN
              RAISE EXCEPTION USING
                  MESSAGE = 'never happens',
                  DETAIL  = format('input=%L', p_input),
                  HINT    = 'this is just here to hurt';
          END IF;
      END;
      $$"
    `);
  });

  test("function with triple-nested dollar quoting and dynamic SQL", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.execception(
p_table regclass
)
RETURNS void
LANGUAGE plpgsql
AS $outer$
DECLARE
    v text;
BEGIN
    v := format($inner$
        DO $do$
        BEGIN
            EXECUTE format(
                'INSERT INTO %s VALUES (''%%s'', now())',
                %L
            ) USING 'payload with ''quotes'' and $dollars';
        END;
        $do$;
    $inner$, p_table);

    EXECUTE v;
END;
$outer$;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE OR REPLACE FUNCTION public.execception (
        p_table regclass
      )
        RETURNS void
        LANGUAGE plpgsql
        AS $outer$
      DECLARE
          v text;
      BEGIN
          v := format($inner$
              DO $do$
              BEGIN
                  EXECUTE format(
                      'INSERT INTO %s VALUES (''%%s'', now())',
                      %L
                  ) USING 'payload with ''quotes'' and $dollars';
              END;
              $do$;
          $inner$, p_table);

          EXECUTE v;
      END;
      $outer$"
    `);
  });

  test("view with DISTINCT ON, WINDOW clause, and INTERVAL frame", () => {
    const sql = `CREATE VIEW public."analytics::daily" AS
SELECT DISTINCT ON (user_id)
    user_id,
    event,
    created_at,
    COUNT(*) FILTER (WHERE event = 'login')
        OVER w                                 AS login_count,
    SUM(value) OVER (
        PARTITION BY user_id
        ORDER BY created_at
        ROWS BETWEEN UNBOUNDED PRECEDING
             AND CURRENT ROW
    )                                         AS running_total
FROM public.events
WINDOW w AS (
    PARTITION BY user_id
    ORDER BY created_at
    RANGE BETWEEN INTERVAL '7 days' PRECEDING
          AND CURRENT ROW
)
ORDER BY
    user_id,
    created_at DESC;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE VIEW public."analytics::daily" AS
      SELECT DISTINCT ON (user_id)
          user_id,
          event,
          created_at,
          COUNT(*) FILTER (WHERE event = 'login')
              OVER w                                 AS login_count,
          SUM(value) OVER (
              PARTITION BY user_id
              ORDER BY created_at
              ROWS BETWEEN UNBOUNDED PRECEDING
                   AND CURRENT ROW
          )                                         AS running_total
      FROM public.events
      WINDOW w AS (
          PARTITION BY user_id
          ORDER BY created_at
          RANGE BETWEEN INTERVAL '7 days' PRECEDING
                AND CURRENT ROW
      )
      ORDER BY
          user_id,
          created_at DESC"
    `);
  });

  test("view with operator soup, IS DISTINCT FROM NULL, nested subquery", () => {
    const sql = `CREATE VIEW public.operator_soup AS
SELECT
    ((((a + b)::numeric ^ 2) /|/ c)::float8 AT TIME ZONE 'UTC')
        IS DISTINCT FROM NULL        AS meaning_of_life
FROM (
    SELECT
        1 AS a,
        2 AS b,
        3 AS c
) s;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE VIEW public.operator_soup AS
      SELECT
          ((((a + b)::numeric ^ 2) /|/ c)::float8 AT TIME ZONE 'UTC')
              IS DISTINCT FROM NULL        AS meaning_of_life
      FROM (
          SELECT
              1 AS a,
              2 AS b,
              3 AS c
      ) s"
    `);
  });

  test("trigger function with $ in name, IS DISTINCT FROM, jsonb_set", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.trigger$logic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND NEW."order" IS DISTINCT FROM OLD."order"
    THEN
        NEW.audit := jsonb_set(
            COALESCE(NEW.audit, '{}'::jsonb),
            ARRAY['changed_at'],
            to_jsonb(clock_timestamp()),
            true
        );
    END IF;

    -- RETURN NULL is valid in AFTER triggers
    RETURN NEW;
END;
$$;`;

    const [result] = formatSqlStatements([sql]);
    expect(result).toMatchInlineSnapshot(`
      "CREATE OR REPLACE FUNCTION public.trigger$logic()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
      BEGIN
          IF TG_OP IN ('INSERT', 'UPDATE')
             AND NEW."order" IS DISTINCT FROM OLD."order"
          THEN
              NEW.audit := jsonb_set(
                  COALESCE(NEW.audit, '{}'::jsonb),
                  ARRAY['changed_at'],
                  to_jsonb(clock_timestamp()),
                  true
              );
          END IF;

          -- RETURN NULL is valid in AFTER triggers
          RETURN NEW;
      END;
      $$"
    `);
  });
});
