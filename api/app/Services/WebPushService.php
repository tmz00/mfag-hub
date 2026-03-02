<?php

namespace App\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Throwable;

class WebPushService
{
    public function isConfigured(): bool
    {
        return $this->vapidPublicKey() !== ''
            && $this->vapidPrivateKey() !== ''
            && $this->vapidSubject() !== '';
    }

    public function sendToMany(
        Collection $subscriptions,
        string $title,
        string $body,
        ?string $url = null,
        ?int $notificationId = null
    ): array {
        if ($subscriptions->isEmpty()) {
            return ['queued' => 0, 'succeeded' => 0, 'failed' => 0, 'expiredEndpoints' => []];
        }

        if (!$this->isConfigured()) {
            Log::warning('Web push skipped: VAPID config is missing.');
            return ['queued' => 0, 'succeeded' => 0, 'failed' => 0, 'expiredEndpoints' => []];
        }

        if (!class_exists(WebPush::class) || !class_exists(Subscription::class)) {
            Log::warning('Web push skipped: minishlink/web-push package is not installed.');
            return ['queued' => 0, 'succeeded' => 0, 'failed' => 0, 'expiredEndpoints' => []];
        }

        $webPush = new WebPush([
            'VAPID' => [
                'subject' => $this->vapidSubject(),
                'publicKey' => $this->vapidPublicKey(),
                'privateKey' => $this->vapidPrivateKey(),
            ],
        ]);
        $webPush->setReuseVAPIDHeaders(true);

        $payload = json_encode([
            'title' => $title,
            'body' => $body,
            'url' => $url,
            'notificationId' => $notificationId,
            'tag' => 'mfag-notification',
            'icon' => '/icons//pwa-192x192.png',
        ], JSON_UNESCAPED_SLASHES);

        foreach ($subscriptions as $row) {
            $subscription = Subscription::create([
                'endpoint' => (string) $row->endpoint,
                'publicKey' => $row->public_key ? (string) $row->public_key : null,
                'authToken' => $row->auth_token ? (string) $row->auth_token : null,
                'contentEncoding' => $row->content_encoding ? (string) $row->content_encoding : 'aesgcm',
            ]);

            $webPush->queueNotification($subscription, $payload ?: '{}', [
                'TTL' => 60 * 60 * 12,
                'urgency' => 'normal',
            ]);
        }

        $succeeded = 0;
        $failed = 0;
        $expiredEndpoints = [];

        try {
            foreach ($webPush->flush() as $report) {
                if ($report->isSuccess()) {
                    $succeeded++;
                    continue;
                }

                $failed++;
                $response = $report->getResponse();
                $status = $response ? $response->getStatusCode() : null;
                if ($status === 404 || $status === 410) {
                    $endpoint = (string) $report->getEndpoint();
                    if ($endpoint !== '') {
                        $expiredEndpoints[] = $endpoint;
                    }
                }
            }
        } catch (Throwable $e) {
            Log::error('Web push flush failed', [
                'error' => $e->getMessage(),
            ]);
            return [
                'queued' => (int) $subscriptions->count(),
                'succeeded' => $succeeded,
                'failed' => (int) $subscriptions->count() - $succeeded,
                'expiredEndpoints' => $expiredEndpoints,
            ];
        }

        return [
            'queued' => (int) $subscriptions->count(),
            'succeeded' => $succeeded,
            'failed' => $failed,
            'expiredEndpoints' => $expiredEndpoints,
        ];
    }

    private function vapidPublicKey(): string
    {
        return trim((string) config('services.webpush.public_key', ''));
    }

    private function vapidPrivateKey(): string
    {
        return trim((string) config('services.webpush.private_key', ''));
    }

    private function vapidSubject(): string
    {
        return trim((string) config('services.webpush.subject', ''));
    }
}
