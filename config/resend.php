<?php

return [
    'api_key' => env('RESEND_API_KEY'),
    // This project only sends mail; it does not expose Resend webhook endpoints.
    'routes' => false,
];
