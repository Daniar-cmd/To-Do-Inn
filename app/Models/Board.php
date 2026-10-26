<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Board extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['name', 'description', 'board_type', 'is_default'];

    protected function casts(): array
    {
        return ['is_default' => 'boolean', 'created_at' => 'immutable_datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function flags(): HasMany
    {
        return $this->hasMany(UserFlag::class);
    }

    public function taskLists(): HasMany
    {
        return $this->hasMany(TaskList::class);
    }
}
