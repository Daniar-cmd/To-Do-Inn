<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('task_lists', function (Blueprint $table): void {
            $table->date('due_date')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('task_lists', function (Blueprint $table): void {
            $table->dropColumn('due_date');
        });
    }
};
