<?php

namespace App\Console\Commands;

use App\Support\LegacySchema;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class BaselineLegacyDatabase extends Command
{
    protected $signature = 'legacy:baseline
                            {--apply : Record the baseline after checking the existing schema}
                            {--force : Allow recording the baseline in production}';

    protected $description = 'Check the legacy PostgreSQL schema; only --apply writes migration bookkeeping, never application data';

    public function handle(): int
    {
        $connection = DB::connection();
        $repository = $this->laravel['migration.repository'];

        if ($repository->repositoryExists() && in_array(LegacySchema::MIGRATION, $repository->getRan(), true)) {
            $this->info('The baseline is already recorded. No changes made.');

            return self::SUCCESS;
        }

        $differences = LegacySchema::differences($connection);
        if ($differences !== []) {
            foreach ($differences as $difference) {
                $this->error($difference);
            }

            $this->error('Baseline refused. No changes made.');

            return self::FAILURE;
        }

        if (!$this->option('apply')) {
            $this->info('Schema matches. Read-only check completed; no changes made.');
            $this->line('After making a verified backup, use --apply to record the baseline.');

            return self::SUCCESS;
        }

        if ($this->laravel->environment('production') && !$this->option('force')) {
            $this->error('Production requires an explicit --force in addition to --apply.');

            return self::FAILURE;
        }

        $connection->transaction(function () use ($repository): void {
            if (!$repository->repositoryExists()) {
                $repository->createRepository();
            }

            $repository->log(LegacySchema::MIGRATION, $repository->getNextBatchNumber());
        });

        $this->info('Baseline recorded. Application tables, rows, IDs and sequences were not modified.');

        return self::SUCCESS;
    }
}
