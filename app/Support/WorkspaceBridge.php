<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class WorkspaceBridge
{
    public function handshake(int $userId): array
    {
        return $this->signedRequest('GET', '/internal/handshake', $userId, '')->throw()->json();
    }

    public function toggleTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/toggle', $userId, $input);
    }

    public function updateTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/update', $userId, $input);
    }

    public function createTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/create', $userId, $input);
    }

    public function moveTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/move', $userId, $input);
    }

    public function reorderTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/reorder', $userId, $input);
    }

    public function deleteTask(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/delete', $userId, $input);
    }

    public function stopTaskRepeat(int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        return $this->taskRequest('/internal/tasks/stop-repeat', $userId, $input);
    }

    public function repeatSeries(int $userId, string $seriesId, string $asOf): int
    {
        $body = json_encode(['action' => 'repeat_tasks', 'series_id' => $seriesId, 'as_of' => $asOf], JSON_THROW_ON_ERROR);
        $result = $this->signedRequest('POST', '/internal/tasks/repeat', $userId, $body, 30);
        $data = $result->json();
        if (!$result->successful() || !is_array($data) || ($data['success'] ?? null) !== true
            || !is_int($data['data']['generated'] ?? null)) {
            throw new RuntimeException('Workspace repeat bridge failed with HTTP '.$result->status());
        }
        return $data['data']['generated'];
    }

    private function taskRequest(string $path, int $userId, array $input): \Illuminate\Http\JsonResponse
    {
        $body = json_encode($input, JSON_THROW_ON_ERROR);
        $result = $this->signedRequest('POST', $path, $userId, $body);
        $data = $result->json();
        if (!is_array($data) || !isset($data['success']) || !is_bool($data['success'])) {
            throw new RuntimeException('Invalid workspace bridge response');
        }
        return response()->json($data, $result->status());
    }

    private function signedRequest(string $method, string $path, int $userId, string $body,
        int $timeoutSeconds = 3): \Illuminate\Http\Client\Response
    {
        if ($userId <= 0) {
            throw new RuntimeException('Invalid authenticated user');
        }
        $secret = base64_decode((string) config('workspace_bridge.secret'), true);
        if ($secret === false || strlen($secret) < 32) {
            throw new RuntimeException('Workspace bridge secret is not configured');
        }
        $baseUrl = (string) config('workspace_bridge.url');
        if (!in_array($baseUrl, ['http://127.0.0.1:8002', 'http://[::1]:8002'], true)) {
            throw new RuntimeException('Workspace bridge must use loopback');
        }
        $timestamp = (string) time();
        $nonce = bin2hex(random_bytes(16));
        $message = implode("\n", [$method, $path, (string) $userId, $timestamp, $nonce, hash('sha256', $body)]);
        $signature = hash_hmac('sha256', $message, $secret);
        $request = Http::withHeaders([
            'X-Workspace-User' => (string) $userId,
            'X-Workspace-Issued-At' => $timestamp,
            'X-Workspace-Nonce' => $nonce,
            'X-Workspace-Signature' => $signature,
        ])->timeout($timeoutSeconds);
        if ($method === 'POST') {
            $request = $request->withBody($body, 'application/json');
        }
        return $request->send($method, $baseUrl.$path);
    }
}
