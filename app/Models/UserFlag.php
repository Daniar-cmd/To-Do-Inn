<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UserFlag extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['name', 'color'];

    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    public function taskLists(): HasMany
    {
        return $this->hasMany(TaskList::class, 'flag_id');
    }
}
