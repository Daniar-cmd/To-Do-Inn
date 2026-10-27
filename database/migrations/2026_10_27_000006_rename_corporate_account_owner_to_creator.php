<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE corporate_accounts RENAME COLUMN owner_user_id TO created_by_user_id');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE corporate_accounts RENAME COLUMN created_by_user_id TO owner_user_id');
    }
};
