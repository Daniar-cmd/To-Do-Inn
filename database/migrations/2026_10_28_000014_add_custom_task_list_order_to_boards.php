<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE boards
                ADD COLUMN lists_order_customized BOOLEAN NOT NULL DEFAULT FALSE;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE boards DROP COLUMN lists_order_customized;
            SQL);
    }
};
