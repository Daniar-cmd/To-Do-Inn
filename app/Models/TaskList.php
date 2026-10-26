<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TaskList extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['name', 'description', 'is_important', 'theme'];

    protected function casts(): array
    {
        return ['is_important' => 'boolean', 'created_at' => 'immutable_datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    public function flag(): BelongsTo
    {
        return $this->belongsTo(UserFlag::class, 'flag_id');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class, 'list_id')->orderBy('sort_order')->orderBy('id');
    }
}
