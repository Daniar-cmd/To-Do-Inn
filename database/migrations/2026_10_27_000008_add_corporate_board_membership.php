<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE boards ADD COLUMN corporate_account_id BIGINT REFERENCES corporate_accounts (id) ON DELETE CASCADE');
        DB::statement('CREATE INDEX boards_corporate_account_idx ON boards (corporate_account_id) WHERE corporate_account_id IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX boards_corporate_account_idx');
        DB::statement('ALTER TABLE boards DROP COLUMN corporate_account_id');
    }
};
