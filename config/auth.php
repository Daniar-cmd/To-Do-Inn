<?php

use App\Models\User;

return [
    // New registrations stay closed until an operator explicitly re-enables them.
    'registration_enabled' => (bool) env('REGISTRATION_ENABLED', false),
    'defaults' => ['guard' => 'web'],
    'guards' => [
        'web' => ['driver' => 'session', 'provider' => 'users'],
    ],
    'providers' => [
        'users' => ['driver' => 'eloquent', 'model' => User::class],
    ],
];
