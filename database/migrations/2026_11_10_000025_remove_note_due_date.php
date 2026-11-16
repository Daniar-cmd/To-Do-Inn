<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE notes DROP COLUMN due_date');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE notes ADD COLUMN due_date DATE');
    }
};
