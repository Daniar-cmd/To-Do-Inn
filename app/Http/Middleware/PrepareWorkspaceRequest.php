<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Response;

class PrepareWorkspaceRequest
{
    public function __construct(private VerifyApiCsrfToken $csrf)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        // Auth has already run. Preserve legacy method/content-type/CSRF/body check ordering.
        if (!in_array($request->method(), ['GET', 'POST', 'DELETE'], true)) {
            return $this->error(405, 'Method not allowed', ['Allow' => 'GET, POST, DELETE']);
        }
        if ($request->isMethod('POST')
            && !preg_match('/^application\/json(?:\s*;|$)/i', $request->header('Content-Type', ''))) {
            return $this->error(415, 'Expected a JSON request');
        }

        $response = $this->csrf->handle($request, function (Request $request) use ($next): Response {
            if ($request->isMethod('POST')) {
                $raw = stream_get_contents($request->getContent(asResource: true), 8193);
                if ($raw === false || strlen($raw) > 8192) {
                    return $this->error(413, 'Request is too large');
                }
                $input = json_decode($raw, true);
                if (!is_array($input) || json_last_error() !== JSON_ERROR_NONE) {
                    return $this->error(400, 'Invalid JSON request');
                }
                $request->setJson(new InputBag($input));
            }

            return $next($request);
        });

        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }

    private function error(int $status, string $message, array $headers = []): JsonResponse
    {
        return response()->json(['success' => false, 'error' => $message], $status, $headers)
            ->header('Cache-Control', 'no-store')->header('X-Content-Type-Options', 'nosniff');
    }
}
