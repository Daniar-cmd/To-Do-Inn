<?php

namespace App\Support;

use Illuminate\Database\Connection;

/** PostgreSQL metadata used only to adopt the existing five-table schema safely. */
class LegacySchema
{
    public const MIGRATION = '2026_10_26_000000_create_todo_tables';

    public const TABLES = ['users', 'boards', 'user_flags', 'task_lists', 'tasks'];

    public static function describe(Connection $connection): array
    {
        $tables = array_fill_keys(self::TABLES, ['columns' => [], 'constraints' => [], 'indexes' => []]);
        $placeholders = implode(', ', array_fill(0, count(self::TABLES), '?'));

        $columns = $connection->select(<<<SQL
            SELECT t.relname AS table_name, a.attname AS column_name,
                   format_type(a.atttypid, a.atttypmod) AS type,
                   a.attnotnull AS not_null, a.attidentity AS identity,
                   pg_get_expr(d.adbin, d.adrelid) AS default_value
            FROM pg_attribute a
            JOIN pg_class t ON t.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE n.nspname = 'public' AND t.relkind = 'r'
              AND t.relname IN ($placeholders) AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY t.relname, a.attname
            SQL, self::TABLES);

        foreach ($columns as $column) {
            $tables[$column->table_name]['columns'][$column->column_name] = [
                'type' => $column->type,
                'nullable' => !$column->not_null,
                'identity' => $column->identity,
                'default' => $column->default_value,
            ];
        }

        $constraints = $connection->select(<<<SQL
            SELECT t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname IN ($placeholders) AND c.contype IN ('p', 'u', 'f', 'c')
            SQL, self::TABLES);

        foreach ($constraints as $constraint) {
            $tables[$constraint->table_name]['constraints'][] = $constraint->definition
                . ($constraint->validated ? '' : ' [NOT VALIDATED]');
        }

        $indexes = $connection->select(<<<SQL
            SELECT t.relname AS table_name, i.indisunique AS is_unique, i.indisvalid AS is_valid,
                   substring(pg_get_indexdef(i.indexrelid) FROM 'USING .*') AS definition
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname IN ($placeholders)
              AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.contype IN ('p', 'u'))
            SQL, self::TABLES);

        foreach ($indexes as $index) {
            $tables[$index->table_name]['indexes'][] = ($index->is_unique ? 'UNIQUE ' : '') . $index->definition
                . ($index->is_valid ? '' : ' [INVALID]');
        }

        foreach ($tables as &$table) {
            // Historical schema.sql can create equivalent foreign keys twice; names and duplicates do not matter.
            $table['constraints'] = array_values(array_unique($table['constraints']));
            sort($table['constraints']);
            sort($table['indexes']);
        }

        return $tables;
    }

    public static function differences(Connection $connection): array
    {
        $expected = json_decode(file_get_contents(database_path('legacy-baseline.json')), true, flags: JSON_THROW_ON_ERROR);
        $actual = self::describe($connection);
        $differences = [];

        foreach (self::TABLES as $name) {
            foreach (['columns', 'constraints', 'indexes'] as $section) {
                $actualSection = $actual[$name][$section];
                $expectedSection = $expected[$name][$section];

                if ($section === 'constraints') {
                    $actualSection = array_map(self::normalizeTextArray(...), $actualSection);
                    $expectedSection = array_map(self::normalizeTextArray(...), $expectedSection);
                    sort($actualSection);
                    sort($expectedSection);
                }

                if ($section === 'indexes') {
                    // Extra non-unique performance indexes do not change the data contract.
                    // Extra unique indexes can reject otherwise valid writes and require review.
                    $missing = array_diff($expectedSection, $actualSection);
                    $extraUnique = array_filter(
                        array_diff($actualSection, $expectedSection),
                        fn (string $index) => str_starts_with($index, 'UNIQUE ') || str_contains($index, '[INVALID]'),
                    );
                    $matches = $missing === [] && $extraUnique === [];
                } else {
                    $matches = $actualSection === $expectedSection;
                }

                if (!$matches) {
                    $differences[] = "$name: $section differ from the baseline; review schema changes before adopting it.";
                }
            }
        }

        return $differences;
    }

    private static function normalizeTextArray(string $definition): string
    {
        // PostgreSQL dumps may cast each VARCHAR literal to TEXT or cast the entire array.
        // Normalize only these two equivalent forms, not arbitrary CHECK expressions.
        $literal = "'(?:[^']|'')*'::character varying";
        $definition = preg_replace_callback(
            '/\(ARRAY\[((?:'.$literal.')(?:, '.$literal.')*)\]\)::text\[\]/',
            fn (array $match) => 'ARRAY['.str_replace('::character varying', '::text', $match[1]).']',
            $definition,
        );

        return preg_replace("/\(('(?:[^']|'')*')::character varying\)::text/", '$1::text', $definition);
    }
}
