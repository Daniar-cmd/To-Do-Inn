<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE notes ADD COLUMN image_data BYTEA NULL, ADD COLUMN image_mime VARCHAR(32) NULL, ADD COLUMN image_offset INTEGER NULL, ADD CONSTRAINT notes_image_metadata_check CHECK ((image_data IS NULL AND image_mime IS NULL AND image_offset IS NULL) OR (image_data IS NOT NULL AND image_mime IS NOT NULL AND image_mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/avif') AND image_offset IS NOT NULL AND image_offset >= 0))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE notes DROP CONSTRAINT notes_image_metadata_check, DROP COLUMN image_data, DROP COLUMN image_mime, DROP COLUMN image_offset');
    }
};
