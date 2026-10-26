<?php

namespace Tests\Feature;

use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Http;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class PreviewRouterTest extends TestCase
{
    public function test_real_http_preview_uses_laravel_sessions_and_never_executes_legacy_api_files(): void
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        $port = substr($address, strrpos($address, ':') + 1);
        $base = 'http://127.0.0.1:'.$port;
        $storage = storage_path('framework/cache/data/preview-http-'.bin2hex(random_bytes(8)));
        $files = new Filesystem;

        foreach (['framework/sessions', 'framework/cache/data', 'framework/views', 'logs'] as $directory) {
            $files->ensureDirectoryExists($storage.'/'.$directory);
        }

        // A separate storage tree keeps preview cookies/cache away from the developer's sessions.
        $server = new Process([
            PHP_BINARY, '-S', '127.0.0.1:'.$port, '-t', public_path(), base_path('server.php'),
        ], base_path(), [
            'APP_ENV' => 'testing',
            'APP_KEY' => config('app.key'),
            'DB_HOST' => '127.0.0.1',
            'DB_DATABASE' => 'todo_inn_laravel_test',
            'SESSION_DRIVER' => 'file',
            'SESSION_SECURE_COOKIE' => 'false',
            'CACHE_STORE' => 'file',
            'LOG_CHANNEL' => 'null',
            'LARAVEL_STORAGE_PATH' => $storage,
        ]);
        $server->setTimeout(15);

        try {
            $server->start();
            $this->assertTrue($server->waitUntil(fn (string $type, string $output) => str_contains($output, 'Development Server')));

            $this->assertSame(200, Http::timeout(5)->get($base.'/up')->status());
            $session = Http::timeout(5)->get($base.'/api/auth.php');
            $this->assertSame(200, $session->status());
            $this->assertNull($session->json('data.user'));
            $this->assertNotEmpty($session->json('data.csrf_token'));
            // Check the cookie before any POST, so a broken router can never invoke native logout accidentally.
            $this->assertStringStartsWith('todo_inn_laravel_session=', $session->header('Set-Cookie'));
            $cookie = explode(';', $session->header('Set-Cookie'), 2)[0];

            $missingToken = Http::timeout(5)->withHeaders([
                'Cookie' => $cookie, 'Sec-Fetch-Site' => 'same-origin',
            ])->post($base.'/api/auth.php', ['action' => 'logout']);
            $this->assertSame(403, $missingToken->status());
            $this->assertFalse($missingToken->json('success'));

            $logout = Http::timeout(5)->withHeaders([
                'Cookie' => $cookie, 'X-CSRF-TOKEN' => $session->json('data.csrf_token'),
            ])->post($base.'/api/auth.php', ['action' => 'logout']);
            $this->assertSame(200, $logout->status());
            $this->assertTrue($logout->json('data.logged_out'));

            $profile = Http::timeout(5)->withoutRedirecting()->get($base.'/api/profile.php');
            $this->assertSame(401, $profile->status());
            $this->assertSame(['success' => false, 'error' => 'Требуется войти в аккаунт.'], $profile->json());

            $workspace = Http::timeout(5)->withoutRedirecting()->get($base.'/api/workspace.php');
            $this->assertSame(401, $workspace->status());
            $this->assertSame(['success' => false, 'error' => 'Требуется войти в аккаунт.'], $workspace->json());

            foreach (['workspace.php/extra', 'auth.php/extra', 'profile.php/extra'] as $path) {
                $response = Http::timeout(5)->withoutRedirecting()->get($base.'/api/'.$path);
                $this->assertSame(404, $response->status());
                $this->assertSame(['success' => false, 'error' => 'Ресурс не найден.'], $response->json());
            }

            $this->assertSame(200, Http::timeout(5)->get($base.'/favicon.svg')->status());
        } finally {
            $server->stop(3);
            // Only the randomly named storage tree created above belongs to this test.
            $files->deleteDirectory($storage);
        }
    }
}
