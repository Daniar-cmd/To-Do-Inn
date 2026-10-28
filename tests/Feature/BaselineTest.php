<?php

namespace Tests\Feature;

use App\Support\LegacySchema;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\DatabaseTestCase;

class BaselineTest extends DatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // These tests exercise adoption of the frozen legacy schema, so temporarily restore
        // that schema inside the test transaction after all forward migrations are applied.
        $skyThemeMigration = require database_path('migrations/2026_10_28_000016_add_sky_task_list_theme.php');
        $skyThemeMigration->down();
        $dueDateMigration = require database_path('migrations/2026_10_28_000015_add_task_list_due_date.php');
        $dueDateMigration->down();
        $customListOrderMigration = require database_path('migrations/2026_10_28_000014_add_custom_task_list_order_to_boards.php');
        $customListOrderMigration->down();
        $taskListPinOrderMigration = require database_path('migrations/2026_10_28_000013_add_task_list_pin_and_order.php');
        $taskListPinOrderMigration->down();
        $registrationVersionMigration = require database_path('migrations/2026_10_27_000012_add_registration_version_to_users.php');
        $registrationVersionMigration->down();
        $notificationsMigration = require database_path('migrations/2026_10_27_000011_create_notifications.php');
        $notificationsMigration->down();
        $telegramLinksMigration = require database_path('migrations/2026_10_27_000010_add_telegram_profile_links.php');
        $telegramLinksMigration->down();
        $registrationPreferencesMigration = require database_path('migrations/2026_10_27_000009_add_registration_preferences_and_consents.php');
        $registrationPreferencesMigration->down();
        $corporateBoardMigration = require database_path('migrations/2026_10_27_000008_add_corporate_board_membership.php');
        $corporateBoardMigration->down();
        $corporateRootMigration = require database_path('migrations/2026_10_27_000007_add_corporate_root_credentials.php');
        $corporateRootMigration->down();
        $corporateAccountCreatorMigration = require database_path('migrations/2026_10_27_000006_rename_corporate_account_owner_to_creator.php');
        $corporateAccountCreatorMigration->down();
        $corporateAccountsMigration = require database_path('migrations/2026_10_27_000005_create_corporate_accounts.php');
        $corporateAccountsMigration->down();
        $middleNameMigration = require database_path('migrations/2026_10_27_000004_add_middle_name_to_users.php');
        $middleNameMigration->down();
        $organizationTypesMigration = require database_path('migrations/2026_10_27_000003_split_organization_types.php');
        $organizationTypesMigration->down();
        $handleMigration = require database_path('migrations/2026_10_27_000002_username_handle_prefix.php');
        $handleMigration->down();
        $organizationMigration = require database_path('migrations/2026_10_27_000001_add_organization_details.php');
        $organizationMigration->down();
        $usernameMigration = require database_path('migrations/2026_10_27_000000_tighten_username_format.php');
        $usernameMigration->down();
        $registrationMigration = require database_path('migrations/2026_10_26_000001_update_registration_identity.php');
        $registrationMigration->down();
    }

    public function test_the_clean_migration_matches_the_frozen_baseline(): void
    {
        $this->assertSame([], LegacySchema::differences(DB::connection()));
    }

    public function test_the_migration_refuses_to_recreate_existing_application_tables(): void
    {
        $user = $this->createUser();
        $migration = require database_path('migrations/'.LegacySchema::MIGRATION.'.php');

        try {
            $migration->up();
            $this->fail('An existing schema must not be recreated.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('legacy:baseline', $exception->getMessage());
        }

        $this->assertSame($user->username, $user->fresh()->username);
    }

    public function test_automatic_baseline_rollback_cannot_drop_adopted_tables(): void
    {
        $migration = require database_path('migrations/'.LegacySchema::MIGRATION.'.php');

        try {
            $migration->down();
            $this->fail('The baseline must not drop application tables on rollback.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('cannot be rolled back', $exception->getMessage());
        }

        $this->assertTrue(Schema::hasTable('users'));
        $this->assertTrue(Schema::hasTable('tasks'));
    }

    public function test_a_dry_run_does_not_even_create_the_migration_table(): void
    {
        Schema::drop('migrations');

        $this->assertSame(0, Artisan::call('legacy:baseline'));
        $this->assertFalse(Schema::hasTable('migrations'));
        $this->assertStringContainsString('Read-only', Artisan::output());
    }

    public function test_adoption_preserves_rows_hashes_unused_flags_and_identity_sequences(): void
    {
        $user = $this->createUser();
        $board = $user->boards()->create(['name' => 'Existing default', 'is_default' => true]);
        $flag = $user->flags()->make(['name' => 'Unused flag must survive']);
        $flag->board()->associate($board);
        $flag->save();
        $list = $user->taskLists()->make(['name' => 'Existing list']);
        $list->board()->associate($board);
        $list->save();
        $task = $user->tasks()->make(['title' => 'Existing task']);
        $task->taskList()->associate($list);
        $task->save();
        Schema::drop('migrations');
        $before = $this->applicationState();

        $this->assertSame(0, Artisan::call('legacy:baseline', ['--apply' => true]));
        $this->assertSame($before, $this->applicationState());
        $this->assertSame([LegacySchema::MIGRATION], DB::table('migrations')->pluck('migration')->all());

        $this->assertSame(0, Artisan::call('legacy:baseline', ['--apply' => true]));
        $this->assertSame(1, DB::table('migrations')->count());
        $this->assertSame($before, $this->applicationState());
    }

    #[DataProvider('schemaChanges')]
    public function test_schema_drift_refuses_adoption_without_bookkeeping_writes(string $sql): void
    {
        Schema::drop('migrations');
        DB::unprepared($sql);

        $this->assertSame(1, Artisan::call('legacy:baseline', ['--apply' => true]));
        $this->assertFalse(Schema::hasTable('migrations'));
        $this->assertStringContainsString('Baseline refused', Artisan::output());
    }

    public static function schemaChanges(): array
    {
        return [
            'missing column' => ['ALTER TABLE tasks DROP COLUMN title'],
            'changed type' => ['ALTER TABLE tasks ALTER COLUMN title TYPE VARCHAR(100)'],
            'changed nullability' => ['ALTER TABLE users ALTER COLUMN about DROP NOT NULL'],
            'changed default' => ['ALTER TABLE tasks ALTER COLUMN sort_order SET DEFAULT 1'],
            'changed identity mode' => ['ALTER TABLE users ALTER COLUMN id SET GENERATED BY DEFAULT'],
            'missing ownership constraint' => ['ALTER TABLE task_lists DROP CONSTRAINT task_lists_board_id_user_id_fkey'],
            'missing index' => ['DROP INDEX tasks_list_order_idx'],
            'extra uniqueness restriction' => ['CREATE UNIQUE INDEX extra_about_unique ON users (about)'],
        ];
    }

    public function test_additional_non_unique_performance_indexes_do_not_block_adoption(): void
    {
        DB::statement('CREATE INDEX extra_tasks_created ON tasks (list_id, created_at, id)');

        $this->assertSame([], LegacySchema::differences(DB::connection()));
    }

    public function test_equivalent_text_array_checks_after_pg_dump_are_accepted(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_account_type_check;
            ALTER TABLE users ADD CONSTRAINT users_account_type_check
                CHECK (account_type::text = ANY (ARRAY[('individual'::varchar)::text, ('team'::varchar)::text, ('corporate'::varchar)::text]));
            SQL);

        $this->assertSame([], LegacySchema::differences(DB::connection()));
    }

    public function test_production_adoption_requires_explicit_force(): void
    {
        Schema::drop('migrations');
        $this->app->instance('env', 'production');

        $this->assertSame(1, Artisan::call('legacy:baseline', ['--apply' => true]));
        $this->assertFalse(Schema::hasTable('migrations'));

        $this->assertSame(0, Artisan::call('legacy:baseline', ['--apply' => true, '--force' => true]));
        $this->assertSame(1, DB::table('migrations')->count());
    }

    private function applicationState(): array
    {
        $state = [];
        foreach (LegacySchema::TABLES as $table) {
            $state[$table] = (array) DB::selectOne(
                "SELECT count(*) AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY id), '')) AS checksum FROM $table t",
            );
            $state[$table]['sequence'] = (array) DB::selectOne("SELECT last_value, is_called FROM {$table}_id_seq");
        }

        return $state;
    }
}
