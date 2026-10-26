<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Task extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['title', 'sort_order', 'is_completed'];

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
            'is_completed' => 'boolean',
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
