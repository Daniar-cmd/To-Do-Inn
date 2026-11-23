WITH relations AS (
    SELECT c.oid, c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname IN ('users', 'boards', 'task_lists', 'tasks', 'notes', 'user_flags',
                         'corporate_accounts', 'corporate_account_members', 'notifications')
), metadata AS (
    SELECT 'table:' || r.relname AS object_name,
        jsonb_build_array(r.relkind, r.relpersistence, r.relrowsecurity, r.relforcerowsecurity) AS definition
    FROM relations r
    UNION ALL
    SELECT 'column:' || r.relname || '.' || a.attname,
        jsonb_build_array(format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated,
            CASE WHEN a.attcollation <> t.typcollation THEN coll.collname END, pg_get_expr(d.adbin, d.adrelid))
    FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint:' || r.relname || '.' || c.conname,
        jsonb_build_array(c.contype, c.convalidated, pg_get_constraintdef(c.oid, true))
    FROM relations r JOIN pg_constraint c ON c.conrelid = r.oid
    -- PostgreSQL 18 represents NOT NULL as a separate constraint. The column captures it on all versions.
    WHERE c.contype <> 'n'
    UNION ALL
    SELECT 'index:' || r.relname || '.' || c.relname,
        jsonb_build_array(i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid))
    FROM relations r JOIN pg_index i ON i.indrelid = r.oid
    JOIN pg_class c ON c.oid = i.indexrelid
    UNION ALL
    SELECT 'sequence:' || r.relname || '.' || a.attname,
        jsonb_build_array(seq.relname, ns.nspname, d.deptype, format_type(s.seqtypid, NULL),
            s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle)
    FROM relations r
    JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = r.oid AND d.refobjsubid > 0
        AND d.classid = 'pg_class'::regclass AND d.objsubid = 0 AND d.deptype IN ('a', 'i')
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = d.refobjsubid
    JOIN pg_sequence s ON s.seqrelid = d.objid
    JOIN pg_class seq ON seq.oid = s.seqrelid
    JOIN pg_namespace ns ON ns.oid = seq.relnamespace
    UNION ALL
    SELECT 'laravel:' || migration, jsonb_build_array(count(*))
    FROM public.migrations GROUP BY migration
)
SELECT object_name, definition::text FROM metadata ORDER BY object_name COLLATE "C";
