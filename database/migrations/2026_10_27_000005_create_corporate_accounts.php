<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TABLE corporate_accounts (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                owner_user_id BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE corporate_account_members (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                corporate_account_id BIGINT NOT NULL REFERENCES corporate_accounts (id) ON DELETE CASCADE,
                user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
                email VARCHAR(254) NOT NULL,
                role VARCHAR(16) NOT NULL,
                invitation_token_hash CHAR(64),
                invitation_expires_at TIMESTAMPTZ,
                accepted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT corporate_account_members_role_check CHECK (role IN ('owner', 'admin', 'manager', 'support'))
            );

            CREATE UNIQUE INDEX corporate_account_members_email_idx
                ON corporate_account_members (corporate_account_id, LOWER(email));
            CREATE UNIQUE INDEX corporate_account_members_user_idx
                ON corporate_account_members (corporate_account_id, user_id) WHERE user_id IS NOT NULL;
            CREATE UNIQUE INDEX corporate_account_members_owner_idx
                ON corporate_account_members (corporate_account_id) WHERE role = 'owner';
            CREATE UNIQUE INDEX corporate_account_members_invitation_token_idx
                ON corporate_account_members (invitation_token_hash) WHERE invitation_token_hash IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TABLE corporate_account_members; DROP TABLE corporate_accounts;');
    }
};
