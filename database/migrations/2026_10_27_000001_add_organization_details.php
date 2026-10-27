<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                ADD COLUMN organization_type VARCHAR(16),
                ADD COLUMN organization_name VARCHAR(160),
                ADD CONSTRAINT users_organization_type_check CHECK (
                    organization_type IS NULL
                    OR organization_type IN ('ИП', 'ООО', 'ПАО', 'НПАО', 'НКО', 'ГУП/МУП', 'Другое')
                ),
                ADD CONSTRAINT users_organization_pair_check CHECK (
                    (organization_type IS NULL AND organization_name IS NULL)
                    OR (organization_type IS NOT NULL AND organization_name IS NOT NULL)
                );
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                DROP CONSTRAINT users_organization_pair_check,
                DROP CONSTRAINT users_organization_type_check,
                DROP COLUMN organization_type,
                DROP COLUMN organization_name;
            SQL);
    }
};
