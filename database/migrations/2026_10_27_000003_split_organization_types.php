<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_organization_type_check;
            ALTER TABLE users ADD CONSTRAINT users_organization_type_check CHECK (
                organization_type IS NULL
                OR organization_type IN ('ИП', 'ООО', 'ПАО', 'НПАО', 'НКО', 'ГУП/МУП', 'ГУП', 'МУП', 'Другое')
            );
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users DROP CONSTRAINT users_organization_type_check;
            ALTER TABLE users ADD CONSTRAINT users_organization_type_check CHECK (
                organization_type IS NULL
                OR organization_type IN ('ИП', 'ООО', 'ПАО', 'НПАО', 'НКО', 'ГУП/МУП', 'Другое')
            );
            SQL);
    }
};
