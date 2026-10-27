<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users
                ADD COLUMN github_url VARCHAR(255),
                ADD COLUMN preferred_theme VARCHAR(16) NOT NULL DEFAULT 'system'
                    CHECK (preferred_theme IN ('light', 'dark', 'system')),
                ADD COLUMN personal_data_consent_at TIMESTAMPTZ,
                ADD COLUMN personal_data_consent_version VARCHAR(32),
                ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN marketing_consent_at TIMESTAMPTZ,
                ADD CONSTRAINT users_personal_data_consent_pair CHECK (
                    (personal_data_consent_at IS NULL AND personal_data_consent_version IS NULL)
                    OR (personal_data_consent_at IS NOT NULL AND personal_data_consent_version IS NOT NULL)
                ),
                ADD CONSTRAINT users_marketing_consent_pair CHECK (
                    (marketing_consent = FALSE AND marketing_consent_at IS NULL)
                    OR (marketing_consent = TRUE AND marketing_consent_at IS NOT NULL)
                ),
                ADD CONSTRAINT users_github_url_format CHECK (
                    github_url IS NULL OR github_url ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/?$'
                );

            ALTER TABLE corporate_accounts
                ADD COLUMN secondary_email VARCHAR(254),
                ADD COLUMN description TEXT NOT NULL DEFAULT '',
                ADD COLUMN avatar_data BYTEA,
                ADD COLUMN avatar_mime VARCHAR(24),
                ADD COLUMN github_url VARCHAR(255),
                ADD COLUMN preferred_theme VARCHAR(16) NOT NULL DEFAULT 'system'
                    CHECK (preferred_theme IN ('light', 'dark', 'system')),
                ADD COLUMN personal_data_consent_at TIMESTAMPTZ,
                ADD COLUMN personal_data_consent_version VARCHAR(32),
                ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN marketing_consent_at TIMESTAMPTZ,
                ADD CONSTRAINT corporate_accounts_emails_different CHECK (
                    root_email IS NULL OR secondary_email IS NULL OR LOWER(root_email) <> LOWER(secondary_email)
                ),
                ADD CONSTRAINT corporate_accounts_avatar_pair CHECK (
                    (avatar_data IS NULL AND avatar_mime IS NULL)
                    OR (avatar_data IS NOT NULL AND avatar_mime IN ('image/jpeg', 'image/png', 'image/webp'))
                ),
                ADD CONSTRAINT corporate_accounts_personal_data_consent_pair CHECK (
                    (personal_data_consent_at IS NULL AND personal_data_consent_version IS NULL)
                    OR (personal_data_consent_at IS NOT NULL AND personal_data_consent_version IS NOT NULL)
                ),
                ADD CONSTRAINT corporate_accounts_marketing_consent_pair CHECK (
                    (marketing_consent = FALSE AND marketing_consent_at IS NULL)
                    OR (marketing_consent = TRUE AND marketing_consent_at IS NOT NULL)
                ),
                ADD CONSTRAINT corporate_accounts_github_url_format CHECK (
                    github_url IS NULL OR github_url ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/?$'
                );

            CREATE UNIQUE INDEX corporate_accounts_secondary_email_unique
                ON corporate_accounts (LOWER(secondary_email)) WHERE secondary_email IS NOT NULL;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP INDEX corporate_accounts_secondary_email_unique;
            ALTER TABLE corporate_accounts
                DROP CONSTRAINT corporate_accounts_github_url_format,
                DROP CONSTRAINT corporate_accounts_marketing_consent_pair,
                DROP CONSTRAINT corporate_accounts_personal_data_consent_pair,
                DROP CONSTRAINT corporate_accounts_avatar_pair,
                DROP CONSTRAINT corporate_accounts_emails_different,
                DROP COLUMN marketing_consent_at,
                DROP COLUMN marketing_consent,
                DROP COLUMN personal_data_consent_version,
                DROP COLUMN personal_data_consent_at,
                DROP COLUMN preferred_theme,
                DROP COLUMN github_url,
                DROP COLUMN avatar_mime,
                DROP COLUMN avatar_data,
                DROP COLUMN description,
                DROP COLUMN secondary_email;

            ALTER TABLE users
                DROP CONSTRAINT users_github_url_format,
                DROP CONSTRAINT users_marketing_consent_pair,
                DROP CONSTRAINT users_personal_data_consent_pair,
                DROP COLUMN marketing_consent_at,
                DROP COLUMN marketing_consent,
                DROP COLUMN personal_data_consent_version,
                DROP COLUMN personal_data_consent_at,
                DROP COLUMN preferred_theme,
                DROP COLUMN github_url;
            SQL);
    }
};
