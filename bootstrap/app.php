<?php

use App\Http\Middleware\PrepareAuthRequest;
use App\Http\Middleware\PrepareProfileRequest;
use App\Http\Middleware\PrepareWorkspaceRequest;
use Illuminate\Database\QueryException;
use App\Http\Middleware\VerifyApiCsrfToken;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Legacy validation is exact: do not silently trim credentials or turn optional empty fields into null.
        $middleware->trimStrings(except: [fn (Request $request) => $request->is('api/*')]);
        $middleware->convertEmptyStringsToNull(except: [fn (Request $request) => $request->is('api/*')]);
        $middleware->redirectGuestsTo(null);
        $middleware->web(
            prepend: [PrepareAuthRequest::class],
            replace: [PreventRequestForgery::class => VerifyApiCsrfToken::class],
        );
        // Authentication must precede profile's CSRF/body checks, and the body must be bounded before throttling.
        $middleware->appendToPriorityList(AuthenticatesRequests::class, PrepareProfileRequest::class);
        $middleware->appendToPriorityList(AuthenticatesRequests::class, PrepareWorkspaceRequest::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(function (Throwable $exception, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            $status = match (true) {
                $exception instanceof AuthenticationException => 401,
                $exception instanceof ValidationException => 422,
                $exception instanceof HttpExceptionInterface => $exception->getStatusCode(),
                default => 500,
            };

            $message = match ($status) {
                401 => 'Требуется войти в аккаунт.',
                403 => 'Доступ запрещён.',
                404 => 'Ресурс не найден.',
                405 => 'Метод не поддерживается.',
                419 => 'Сессия истекла. Обновите страницу.',
                422 => 'Проверьте введённые данные.',
                429 => 'Слишком много запросов. Попробуйте позже.',
                default => 'Не удалось выполнить запрос. Попробуйте позже.',
            };

            if ($status === 419) {
                $status = 403;
                $message = $request->is('api/auth.php')
                    ? 'Session expired. Refresh the page and try again.'
                    : 'Сессия истекла. Обновите страницу.';
            }

            if ($request->is('api/auth.php', 'api/profile.php') && $exception instanceof ValidationException) {
                // Only explicit validator messages, never SQL/exception details or submitted values.
                $message = array_values($exception->errors())[0][0] ?? 'Проверьте введённые данные.';
            }

            // Keep exception headers such as Allow and Retry-After, never exception details.
            $headers = $exception instanceof HttpExceptionInterface ? $exception->getHeaders() : [];

            if ($request->is('api/auth.php', 'api/profile.php') && $status === 405) {
                $headers['Allow'] = 'GET, POST';
                $message = 'Method not allowed';
            }
            if ($request->is('api/auth.php') && $status === 413) {
                $message = 'Request is too large';
            }
            if ($request->is('api/profile.php') && $status === 413) {
                $message = 'Запрос слишком большой.';
            }
            if ($request->is('api/profile.php') && $status >= 500) {
                $message = 'Не удалось сохранить профиль. Попробуйте позже.';
            }
            if ($request->is('api/workspace.php') && $status >= 500) {
                $message = $exception instanceof QueryException
                    ? 'Не удалось сохранить изменения. Попробуйте позже.'
                    : 'Не удалось загрузить рабочее пространство.';
            }
            if ($request->is('api/workspace.php') && $status === 405) {
                $headers['Allow'] = 'GET, POST, DELETE';
                $message = 'Method not allowed';
            }
            if ($request->is('api/workspace.php') && $status === 413) {
                $message = 'Request is too large';
            }

            return response()->json(['success' => false, 'error' => $message], $status, $headers)
                ->header('Cache-Control', 'no-store')
                ->header('X-Content-Type-Options', 'nosniff');
        });
    })->create();
