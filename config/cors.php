<?php

// The React app uses same-origin requests through Vite's proxy; no cross-origin access is needed.
// Override Laravel's permissive framework defaults explicitly.
return [
    'paths' => [],
    'allowed_methods' => [],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => [],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
