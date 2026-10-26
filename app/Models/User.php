<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    public const UPDATED_AT = null;

    protected $authPasswordName = 'password_hash';

    // The legacy schema has no remember_token column or "remember me" feature.
    protected $rememberTokenName = '';

    protected $fillable = [
        'username', 'email', 'secondary_email', 'password_hash', 'about', 'account_type',
    ];

    protected $hidden = ['password_hash', 'avatar_data', 'avatar_mime'];

    protected function casts(): array
    {
        return [
            'password_hash' => 'hashed',
            'username_changed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function boards(): HasMany
    {
        return $this->hasMany(Board::class);
    }

    public function flags(): HasMany
    {
        return $this->hasMany(UserFlag::class);
    }

    public function taskLists(): HasMany
    {
        return $this->hasMany(TaskList::class);
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }
}
