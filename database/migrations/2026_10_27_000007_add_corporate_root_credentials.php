<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE corporate_accounts
                ADD COLUMN root_username VARCHAR(24),
                ADD COLUMN root_email VARCHAR(254),
                ADD COLUMN root_password_hash TEXT,
                ADD COLUMN organization_type VARCHAR(16),
                ADD COLUMN organization_name VARCHAR(160),
                ALTER COLUMN created_by_user_id DROP NOT NULL;

            UPDATE corporate_accounts AS accounts
            SET root_username = users.username,
                root_email = users.email,
                root_password_hash = users.password_hash,
                organization_type = users.organization_type,
                organization_name = users.organization_name
            FROM users
            WHERE users.id = accounts.created_by_user_id
                AND users.account_type = 'corporate';

            CREATE UNIQUE INDEX corporate_accounts_root_username_idx
                ON corporate_accounts (LOWER(root_username)) WHERE root_username IS NOT NULL;
            CREATE UNIQUE INDEX corporate_accounts_root_email_idx
                ON corporate_accounts (LOWER(root_email)) WHERE root_email IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP INDEX corporate_accounts_root_email_idx;
            DROP INDEX corporate_accounts_root_username_idx;
            ALTER TABLE corporate_accounts
                DROP COLUMN organization_name,
                DROP COLUMN organization_type,
                DROP COLUMN root_password_hash,
                DROP COLUMN root_email,
                DROP COLUMN root_username;
            SQL);
    }
};
