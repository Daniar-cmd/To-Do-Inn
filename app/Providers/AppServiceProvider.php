<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Existing PHP endpoints remain independent until the API migration is complete.
    }

    public function boot(): void
    {
        // Never run migrations, create users, or modify the legacy database on boot.
        RateLimiter::for('legacy-auth', function (Request $request): array {
            // Trust the actual connection IP; no wildcard proxy trust or client-provided IP headers.
            $ip = $request->ip();
            $limits = [Limit::perMinute(60)->by('auth-all:'.$ip)];
            $action = $request->isMethod('POST') ? $request->json('action') : null;

            if ($action === 'login') {
                $username = $request->json('username');
                $username = is_string($username) ? strtolower($username) : '';
                $limits[] = Limit::perMinute(30)->by('login-ip:'.$ip);
                $limits[] = Limit::perMinute(5)->by('login-user-ip:'.hash('sha256', $username).'|'.$ip);
            }

            if ($action === 'register') {
                $limits[] = Limit::perHour(5)->by('register-hour:'.$ip);
                $limits[] = Limit::perDay(20)->by('register-day:'.$ip);
            }

            return $limits;
        });

        RateLimiter::for('legacy-profile', function (Request $request): array {
            return [
                Limit::perMinute(60)->by('profile-ip:'.$request->ip()),
                Limit::perMinute($request->isMethod('POST') ? 30 : 60)
                    ->by('profile-'.($request->isMethod('POST') ? 'write:' : 'read:').$request->user()->getAuthIdentifier()),
            ];
        });
    }
}
