<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Task extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['title', 'description', 'is_important', 'is_urgent', 'urgency', 'flag_id', 'due_date', 'deadline', 'location', 'scheduled_time', 'repeat_interval', 'repeat_series_id', 'repeat_anchor_date', 'repeat_sequence', 'board_id', 'sort_order', 'is_completed'];

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
            'is_completed' => 'boolean',
            'is_important' => 'boolean',
            'is_urgent' => 'boolean',
            'urgency' => 'integer',
            'due_date' => 'date:Y-m-d',
            'deadline' => 'date:Y-m-d',
            'repeat_anchor_date' => 'date:Y-m-d',
            'repeat_sequence' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function taskList(): BelongsTo
    {
        return $this->belongsTo(TaskList::class, 'list_id');
    }
}
