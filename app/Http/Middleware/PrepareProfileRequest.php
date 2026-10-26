<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Response;

class PrepareProfileRequest
{
    public function __construct(private VerifyApiCsrfToken $csrf)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        // The route's auth middleware has already verified the Laravel session.
        if (!in_array($request->method(), ['GET', 'POST'], true)) {
            $response = $this->error(405, 'Method not allowed')->header('Allow', 'GET, POST');
        } else {
            // Keep legacy ordering: authentication -> method -> CSRF -> bounded JSON -> profile validation.
            $response = $this->csrf->handle($request, function (Request $request) use ($next): Response {
                return $this->checkBody($request) ?? $next($request);
            });
        }

        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }

    private function checkBody(Request $request): ?JsonResponse
    {
        if ($request->isMethod('GET')) {
            return null;
        }

        // The legacy profile endpoint parses JSON regardless of Content-Type. Keep that contract.
        $length = $request->header('Content-Length');
        if (is_string($length) && ctype_digit($length) && (int) $length > 1_500_000) {
            return $this->error(413, 'Запрос слишком большой.');
        }

        $raw = stream_get_contents($request->getContent(asResource: true), 1_500_001);
        if ($raw === false || strlen($raw) > 1_500_000) {
            return $this->error(413, 'Запрос слишком большой.');
        }

        $input = json_decode($raw, true);
        if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
            return $this->error(400, 'Некорректный JSON-запрос.');
        }

        $request->setJson(new InputBag($input));

        return null;
    }

    private function error(int $status, string $message): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status);
    }
}
