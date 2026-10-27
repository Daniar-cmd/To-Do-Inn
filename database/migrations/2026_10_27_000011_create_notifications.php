<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TABLE notifications (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT REFERENCES users (id) ON DELETE CASCADE,
                corporate_account_id BIGINT REFERENCES corporate_accounts (id) ON DELETE CASCADE,
                sender VARCHAR(80) NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMPTZ,
                CONSTRAINT notifications_recipient_check CHECK (
                    (user_id IS NOT NULL AND corporate_account_id IS NULL)
                    OR (user_id IS NULL AND corporate_account_id IS NOT NULL)
                )
            );

            CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL;
            CREATE INDEX notifications_corporate_created_idx ON notifications (corporate_account_id, created_at DESC) WHERE corporate_account_id IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TABLE notifications;');
    }
};
