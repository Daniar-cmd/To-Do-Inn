<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class EnsureCurrentPasswordSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $userId = $request->user()?->getAuthIdentifier();
        if ($userId !== null) {
            $currentVersion = DB::table('users')->where('id', $userId)->value('password_version');
            $sessionVersion = $request->session()->get('password_version', 0);

            // Sessions created before this feature have version 0. A password change
            // increments the database value and expires them on their next request.
            if ($currentVersion === null || !is_int($sessionVersion)
                || (int) $currentVersion !== (int) $sessionVersion) {
                Auth::logout();
                $request->session()->invalidate();
                $request->session()->regenerateToken();

                if ($request->is('api/profile.php', 'api/workspace.php')) {
                    return response()->json(['success' => false, 'error' => 'Требуется войти в аккаунт.'], 401)
                        ->header('Cache-Control', 'no-store')
                        ->header('X-Content-Type-Options', 'nosniff');
                }
            }
        }

        return $next($request);
    }
}
