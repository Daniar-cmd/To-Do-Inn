<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\WorkspaceController;
use App\Http\Middleware\PrepareProfileRequest;
use App\Http\Middleware\PrepareWorkspaceRequest;
use App\Http\Middleware\VerifyApiCsrfToken;
use Illuminate\Support\Facades\Route;

// The preview router sends this URL to Laravel; the main legacy server still runs its PHP file.
// Unsupported methods are explicitly rejected by PrepareAuthRequest before the CSRF check.
Route::any('/api/auth.php', AuthController::class)->middleware('throttle:legacy-auth');

Route::match(['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'], '/api/profile.php', ProfileController::class)
    // PrepareProfileRequest invokes the same CSRF middleware after auth/method checks, before reading JSON.
    ->withoutMiddleware(VerifyApiCsrfToken::class)
    ->middleware(['auth', PrepareProfileRequest::class, 'throttle:legacy-profile']);

Route::match(['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'], '/api/workspace.php', WorkspaceController::class)
    // Preserve legacy auth/method/content-type ordering; preparation still explicitly invokes CSRF.
    ->withoutMiddleware(VerifyApiCsrfToken::class)
    ->middleware(['auth', PrepareWorkspaceRequest::class]);
