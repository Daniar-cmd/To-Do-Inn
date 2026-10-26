<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Response;

/** Preserve the standalone auth API's method, JSON and body-size checks before CSRF. */
class PrepareAuthRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->is('api/auth.php')) {
            return $next($request);
        }

        $response = $this->checkEnvelope($request) ?? $next($request);
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }

    private function checkEnvelope(Request $request): ?JsonResponse
    {
        if (!in_array($request->method(), ['GET', 'POST'], true)) {
            return $this->error(405, 'Method not allowed')->header('Allow', 'GET, POST');
        }

        if ($request->isMethod('GET')) {
            return null;
        }

        if (!preg_match('/^application\/json(?:\s*;|$)/i', $request->header('Content-Type', ''))) {
            return $this->error(415, 'Expected a JSON request');
        }

        $length = $request->header('Content-Length');
        if (is_string($length) && ctype_digit($length) && (int) $length > 8192) {
            return $this->error(413, 'Request is too large');
        }

        $raw = stream_get_contents($request->getContent(asResource: true), 8193);
        if ($raw === false || strlen($raw) > 8192) {
            return $this->error(413, 'Request is too large');
        }

        $input = json_decode($raw, true);
        if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
            return $this->error(400, 'Invalid JSON request');
        }

        $request->setJson(new InputBag($input));

        return null;
    }

    private function error(int $status, string $message): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status);
    }
}
