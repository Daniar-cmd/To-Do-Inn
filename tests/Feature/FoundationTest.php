<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Tests\TestCase;

class FoundationTest extends TestCase
{
    public function test_laravel_health_endpoint_is_available(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_missing_api_routes_return_the_existing_json_error_shape(): void
    {
        $this->getJson('/api/not-implemented')
            ->assertNotFound()
            ->assertExactJson(['success' => false, 'error' => 'Ресурс не найден.'])
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_unexpected_api_errors_do_not_expose_details_even_in_debug_mode(): void
    {
        Route::get('/api/test-failure', fn () => throw new RuntimeException('Private SQL and internal paths'));

        $this->getJson('/api/test-failure')
            ->assertStatus(500)
            ->assertExactJson(['success' => false, 'error' => 'Не удалось выполнить запрос. Попробуйте позже.']);
    }

    public function test_validation_errors_are_json_not_html(): void
    {
        Route::get('/api/test-validation', fn () => throw ValidationException::withMessages(['username' => 'Invalid value']));

        $this->getJson('/api/test-validation')
            ->assertUnprocessable()
            ->assertExactJson(['success' => false, 'error' => 'Проверьте введённые данные.']);
    }

    public function test_http_exception_headers_are_preserved(): void
    {
        Route::get('/api/test-method', fn () => throw new MethodNotAllowedHttpException(['POST']));

        $this->getJson('/api/test-method')->assertStatus(405)->assertHeader('Allow', 'POST');
    }

    public function test_migrated_endpoints_keep_legacy_files_and_require_laravel_auth(): void
    {
        $this->assertFileExists(public_path('api/auth.php'));
        $this->assertFileExists(public_path('api/profile.php'));
        $this->assertFileExists(public_path('api/workspace.php'));
        // This calls the Laravel kernel, not the standalone PHP file.
        $this->getJson('/api/workspace.php')->assertUnauthorized();
    }
}
