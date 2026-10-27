<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ADD COLUMN middle_name VARCHAR(60)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP COLUMN middle_name');
    }
};
