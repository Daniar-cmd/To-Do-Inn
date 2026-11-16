<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PrepareNoteImageRequest
{
    public function __construct(private VerifyApiCsrfToken $csrf)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        if (!in_array($request->method(), ['GET', 'POST', 'DELETE'], true)) {
            return $this->error(405, 'Method not allowed')->header('Allow', 'GET, POST, DELETE');
        }
        if ($request->isMethod('POST')
            && !preg_match('/^multipart\/form-data(?:\s*;|$)/i', $request->header('Content-Type', ''))) {
            return $this->error(415, 'Ожидается файл изображения.');
        }
        $length = $request->header('Content-Length');
        // Allow multipart boundaries/headers while keeping oversized bodies bounded.
        if ($request->isMethod('POST') && is_string($length) && ctype_digit($length) && (int) $length > 1_100_000) {
            return $this->error(413, 'Изображение должно быть не больше 1 МБ.');
        }

        return $this->csrf->handle($request, function (Request $request) use ($next): Response {
            $response = $next($request);
            $response->headers->set('Cache-Control', 'no-store');
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            return $response;
        });
    }

    private function error(int $status, string $message): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status)
            ->header('Cache-Control', 'no-store')->header('X-Content-Type-Options', 'nosniff');
    }
}
