<?php

namespace App\Console\Commands;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class RepeatTasks extends Command
{
    protected $signature = 'tasks:repeat';

    protected $description = 'Create the next dated occurrence of each active repeating task';

    public function handle(): int
    {
        $today = today()->toDateString();
        $series = DB::table('tasks')->whereNotNull('repeat_interval')->whereNotNull('repeat_series_id')
            ->select('user_id', 'repeat_series_id')->distinct()->get();

        foreach ($series as $item) {
            DB::transaction(function () use ($item, $today): void {
                // Workspace writes and this command lock the same owner before appending tasks.
                if (!DB::table('users')->where('id', $item->user_id)->lockForUpdate()->exists()) return;
                $latest = DB::table('tasks')->where('user_id', $item->user_id)
                    ->where('repeat_series_id', $item->repeat_series_id)->whereNotNull('repeat_interval')
                    ->orderByDesc('repeat_sequence')->first();
                if ($latest === null) return;

                // Catch up after downtime, but bound work per run. The next run continues the chain.
                for ($count = 0; $count < 366; $count++) {
                    $scheduled = $latest->due_date ?? $latest->deadline;
                    if ($scheduled === null || $scheduled > $today) break;
                    $sequence = (int) $latest->repeat_sequence + 1;
                    $anchor = CarbonImmutable::parse($latest->repeat_anchor_date, 'UTC');
                    $nextDate = match ($latest->repeat_interval) {
                        'daily' => $anchor->addDays($sequence),
                        'weekly' => $anchor->addWeeks($sequence),
                        'monthly' => $anchor->addMonthsNoOverflow($sequence),
                        'yearly' => $anchor->addYearsNoOverflow($sequence),
                    };
                    $next = $nextDate->toDateString();
                    $sortOrder = DB::table('tasks')->where('user_id', $item->user_id)
                        ->where('list_id', $latest->list_id)->max('sort_order');
                    $id = DB::table('tasks')->insertGetId([
                        'user_id' => $latest->user_id, 'board_id' => $latest->board_id, 'list_id' => $latest->list_id,
                        'title' => $latest->title, 'description' => $latest->description,
                        'is_important' => $latest->is_important, 'urgency' => $latest->urgency,
                        'flag_id' => $latest->flag_id, 'location' => $latest->location,
                        'scheduled_time' => $latest->scheduled_time,
                        'due_date' => $latest->due_date === null ? null : $next,
                        'deadline' => $latest->deadline === null ? null : $next,
                        'repeat_interval' => $latest->repeat_interval,
                        'repeat_series_id' => $latest->repeat_series_id,
                        'repeat_anchor_date' => $latest->repeat_anchor_date,
                        'repeat_sequence' => $sequence,
                        'sort_order' => $sortOrder === null ? 0 : $sortOrder + 1,
                    ]);
                    $latest = DB::table('tasks')->where('id', $id)->first();
                }
            });
        }

        return self::SUCCESS;
    }
}
