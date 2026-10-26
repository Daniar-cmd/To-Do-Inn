<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;

class VerifyApiCsrfToken extends PreventRequestForgery
{
    // React obtains the token from GET /api/auth.php; no extra XSRF cookie is needed.
    protected $addHttpCookie = false;

    protected function runningUnitTests()
    {
        // Exercise the actual CSRF protection in feature tests too, rather than Laravel's default bypass.
        return false;
    }

    protected function hasValidOrigin($request)
    {
        // The existing API always requires a token, even for same-origin browser requests.
        return $request->is('api/*') ? false : parent::hasValidOrigin($request);
    }

    protected function getTokenFromRequest($request)
    {
        return $request->is('api/*') ? $request->header('X-CSRF-TOKEN') : parent::getTokenFromRequest($request);
    }
}
