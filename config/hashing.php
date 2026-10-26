<?php

return [
    // Bcrypt truncates at 72 bytes. Argon2id preserves the existing 6–128 ASCII password contract.
    'driver' => 'argon2id',
    'argon' => [
        'memory' => (int) env('ARGON_MEMORY', 65536),
        'threads' => (int) env('ARGON_THREADS', 1),
        'time' => (int) env('ARGON_TIME', 4),
        // Existing PHP password_hash() bcrypt hashes must remain valid during the migration.
        'verify' => false,
    ],
    'bcrypt' => [
        'rounds' => (int) env('BCRYPT_ROUNDS', 12),
        'verify' => false,
    ],
    // Do not rewrite legacy hashes merely by testing a login against the local database copy.
    'rehash_on_login' => false,
];
