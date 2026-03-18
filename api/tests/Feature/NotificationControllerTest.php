<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\WebPushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NotificationControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_standard_user_only_receives_sent_notifications_and_cannot_view_drafts(): void
    {
        $standard = $this->createUser('standard');

        $sentId = $this->createNotification([
            'title' => 'Sent Notification',
            'sent_at' => Carbon::parse('2026-02-20 09:00:00'),
        ]);
        $draftId = $this->createNotification([
            'title' => 'Draft Notification',
            'sent_at' => null,
        ]);

        Sanctum::actingAs($standard);

        $indexResponse = $this->getJson('/api/notifications?limit=50');
        $indexResponse->assertOk()->assertJsonCount(1, 'notifications');
        $this->assertSame((string) $sentId, (string) $indexResponse->json('notifications.0.id'));
        $this->assertSame('Sent Notification', (string) $indexResponse->json('notifications.0.title'));

        $this->getJson("/api/notifications/{$sentId}")
            ->assertOk()
            ->assertJsonPath('notification.id', (string) $sentId);

        $this->getJson("/api/notifications/{$draftId}")
            ->assertStatus(404)
            ->assertJson(['message' => 'Notification not found.']);
    }

    public function test_admin_can_create_update_and_send_notification(): void
    {
        $admin = $this->createUser('admin', [
            'email' => 'admin-notifications@example.test',
            'fsc_code' => '99001',
            'nickname' => 'Admin Notifications',
        ]);
        Sanctum::actingAs($admin);

        $createResponse = $this->postJson('/api/notifications', [
            'title' => '  Launch update  ',
            'body' => '  Body content  ',
            'type' => 'warning',
            'sendNow' => false,
        ]);
        $createResponse->assertCreated()->assertJsonStructure(['id']);
        $id = (int) $createResponse->json('id');

        $this->assertGreaterThan(0, $id);
        $this->assertDatabaseHas('notifications', [
            'id' => $id,
            'title' => 'Launch update',
            'body' => 'Body content',
            'type' => 'warning',
            'created_by_id' => $admin->id,
            'sent_at' => null,
        ]);

        $updateResponse = $this->putJson("/api/notifications/{$id}", [
            'title' => '  Updated title ',
            'body' => ' Updated body ',
            'type' => 'info',
        ]);
        $updateResponse->assertOk()->assertJson(['id' => (string) $id]);

        $this->assertDatabaseHas('notifications', [
            'id' => $id,
            'title' => 'Updated title',
            'body' => 'Updated body',
            'type' => 'info',
        ]);

        $sendResponse = $this->postJson("/api/notifications/{$id}/send");
        $sendResponse->assertOk()->assertJson(['id' => (string) $id]);
        $this->assertNotNull(
            DB::table('notifications')->where('id', $id)->value('sent_at')
        );

        $adminIndexResponse = $this->getJson('/api/notifications/admin');
        $adminIndexResponse->assertOk();
        $ids = collect($adminIndexResponse->json('notifications'))
            ->map(static fn (array $row): string => (string) ($row['id'] ?? ''))
            ->all();
        $this->assertContains((string) $id, $ids);
    }

    public function test_send_is_idempotent_for_already_sent_notifications(): void
    {
        $webPush = new class extends WebPushService {
            public int $sendCalls = 0;

            public function sendToMany(
                Collection $subscriptions,
                string $title,
                string $body,
                ?string $url = null,
                ?int $notificationId = null
            ): array {
                $this->sendCalls++;

                return [
                    'queued' => 0,
                    'succeeded' => 0,
                    'failed' => 0,
                    'expiredEndpoints' => [],
                ];
            }
        };
        $this->instance(WebPushService::class, $webPush);

        $admin = $this->createUser('admin', [
            'email' => 'admin-idempotent@example.test',
            'fsc_code' => '99002',
        ]);
        $notificationId = $this->createNotification([
            'title' => 'Reminder',
            'body' => 'Check this notice.',
            'sent_at' => null,
        ]);
        Sanctum::actingAs($admin);

        $this->postJson("/api/notifications/{$notificationId}/send")
            ->assertOk()
            ->assertJson(['id' => (string) $notificationId]);

        $sentAt = DB::table('notifications')->where('id', $notificationId)->value('sent_at');
        $this->assertNotNull($sentAt);

        $this->postJson("/api/notifications/{$notificationId}/send")
            ->assertOk()
            ->assertJson(['id' => (string) $notificationId]);

        $this->assertSame(1, $webPush->sendCalls);
    }

    public function test_non_admin_cannot_access_admin_notification_routes(): void
    {
        $standard = $this->createUser('standard');
        $existingNotificationId = $this->createNotification(['sent_at' => null]);
        Sanctum::actingAs($standard);

        $this->getJson('/api/notifications/admin')
            ->assertForbidden()
            ->assertJson(['message' => 'Forbidden.']);

        $this->postJson('/api/notifications', [
            'title' => 'Blocked',
            'body' => 'Blocked',
        ])->assertForbidden()->assertJson(['message' => 'Forbidden.']);

        $this->postJson("/api/notifications/{$existingNotificationId}/send")
            ->assertForbidden()
            ->assertJson(['message' => 'Forbidden.']);
    }

    public function test_admin_can_upload_and_delete_notification_attachment(): void
    {
        Storage::fake('local');
        $admin = $this->createUser('admin');
        $notificationId = $this->createNotification(['sent_at' => null]);
        Sanctum::actingAs($admin);

        $uploadResponse = $this->postJson("/api/notifications/{$notificationId}/attachments", [
            'file' => UploadedFile::fake()->create('memo.pdf', 48, 'application/pdf'),
        ]);

        $uploadResponse->assertCreated()->assertJsonStructure([
            'attachment' => [
                'id',
                'name',
                'mimeType',
                'sizeBytes',
                'downloadUrl',
                'createdAt',
            ],
        ]);

        $fileId = (int) $uploadResponse->json('attachment.id');
        $this->assertGreaterThan(0, $fileId);
        $uploadResponse->assertJsonPath('attachment.name', 'memo.pdf');

        $storedPath = (string) DB::table('notification_files')->where('id', $fileId)->value('storage_path');
        $this->assertSame('notifications/memo.pdf', $storedPath);
        Storage::disk('local')->assertExists($storedPath);

        $this->deleteJson("/api/notifications/{$notificationId}/attachments/{$fileId}")
            ->assertOk()
            ->assertJson(['deleted' => true]);

        Storage::disk('local')->assertMissing($storedPath);
        $this->assertDatabaseMissing('notification_files', ['id' => $fileId]);
    }

    public function test_sent_notifications_cannot_be_modified_with_new_attachments(): void
    {
        Storage::fake('local');
        $admin = $this->createUser('admin');
        $sentNotificationId = $this->createNotification([
            'sent_at' => Carbon::parse('2026-02-20 12:00:00'),
        ]);
        Sanctum::actingAs($admin);

        $this->postJson("/api/notifications/{$sentNotificationId}/attachments", [
            'file' => UploadedFile::fake()->create('blocked.pdf', 40, 'application/pdf'),
        ])->assertStatus(409)->assertJson([
            'message' => 'Sent notifications cannot be modified.',
        ]);
    }

    public function test_sent_notifications_cannot_be_updated_or_deleted(): void
    {
        $admin = $this->createUser('admin');
        $sentNotificationId = $this->createNotification([
            'title' => 'Sent Notification',
            'body' => 'Locked body',
            'sent_at' => Carbon::parse('2026-02-20 12:00:00'),
        ]);
        Sanctum::actingAs($admin);

        $this->putJson("/api/notifications/{$sentNotificationId}", [
            'title' => 'Updated title',
            'body' => 'Updated body',
        ])->assertStatus(409)->assertJson([
            'message' => 'Sent notifications cannot be modified.',
        ]);

        $this->deleteJson("/api/notifications/{$sentNotificationId}")
            ->assertStatus(409)
            ->assertJson([
                'message' => 'Sent notifications cannot be modified.',
            ]);

        $this->assertDatabaseHas('notifications', [
            'id' => $sentNotificationId,
            'title' => 'Sent Notification',
            'body' => 'Locked body',
        ]);
    }

    public function test_notification_attachments_with_duplicate_names_receive_incrementing_suffixes(): void
    {
        Storage::fake('local');
        $admin = $this->createUser('admin');
        $notificationId = $this->createNotification(['sent_at' => null]);
        Sanctum::actingAs($admin);

        $first = $this->postJson("/api/notifications/{$notificationId}/attachments", [
            'file' => UploadedFile::fake()->create('memo.pdf', 48, 'application/pdf'),
        ]);
        $second = $this->postJson("/api/notifications/{$notificationId}/attachments", [
            'file' => UploadedFile::fake()->create('memo.pdf', 52, 'application/pdf'),
        ]);

        $first->assertCreated()->assertJsonPath('attachment.name', 'memo.pdf');
        $second->assertCreated()->assertJsonPath('attachment.name', 'memo (2).pdf');

        $firstPath = (string) DB::table('notification_files')
            ->where('id', (int) $first->json('attachment.id'))
            ->value('storage_path');
        $secondPath = (string) DB::table('notification_files')
            ->where('id', (int) $second->json('attachment.id'))
            ->value('storage_path');

        $this->assertSame('notifications/memo.pdf', $firstPath);
        $this->assertSame('notifications/memo (2).pdf', $secondPath);
        Storage::disk('local')->assertExists($firstPath);
        Storage::disk('local')->assertExists($secondPath);
    }

    public function test_notification_attachment_upload_is_rejected_when_shared_upload_quota_would_be_exceeded(): void
    {
        Storage::fake('local');
        config(['uploads.max_total_bytes' => 100 * 1024]);

        $admin = $this->createUser('admin');
        $notificationId = $this->createNotification(['sent_at' => null]);
        Sanctum::actingAs($admin);

        DB::table('handbook_files')->insert([
            'path' => 'handbook/existing.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 70 * 1024,
            'uploaded_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson("/api/notifications/{$notificationId}/attachments", [
            'file' => UploadedFile::fake()->create('memo.pdf', 40, 'application/pdf'),
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['file']);

        $this->assertDatabaseMissing('notification_files', ['storage_path' => 'notifications/memo.pdf']);
    }

    public function test_admin_cannot_upload_disallowed_notification_attachment_types(): void
    {
        Storage::fake('local');
        $admin = $this->createUser('admin');
        $notificationId = $this->createNotification(['sent_at' => null]);
        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/notifications/{$notificationId}/attachments", [
            'file' => UploadedFile::fake()->create('script.html', 5, 'text/html'),
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['file']);

        $this->assertDatabaseCount('notification_files', 0);
    }

    public function test_read_state_and_unread_count_respect_scope_and_notification_target(): void
    {
        $actor = $this->createUser('standard');
        $other = $this->createUser('standard');
        $admin = $this->createUser('admin');

        $firstNotificationId = $this->createNotification([
            'title' => 'First',
            'sent_at' => Carbon::parse('2026-02-20 10:00:00'),
        ]);
        $secondNotificationId = $this->createNotification([
            'title' => 'Second',
            'sent_at' => Carbon::parse('2026-02-21 10:00:00'),
        ]);

        Sanctum::actingAs($actor);

        $this->getJson("/api/notifications/unread-count/{$actor->id}")
            ->assertOk()
            ->assertJson(['count' => 2]);

        $this->putJson("/api/notifications/read-state/{$actor->id}", [
            'notificationId' => $firstNotificationId,
        ])->assertOk()->assertJson(['ok' => true]);

        $this->getJson("/api/notifications/unread-count/{$actor->id}")
            ->assertOk()
            ->assertJson(['count' => 1]);

        $this->putJson("/api/notifications/read-state/{$other->id}", [
            'notificationId' => $secondNotificationId,
        ])->assertForbidden()->assertJson(['message' => 'Forbidden.']);

        Sanctum::actingAs($admin);

        $this->putJson("/api/notifications/read-state/{$other->id}", [
            'notificationId' => $secondNotificationId,
        ])->assertOk()->assertJson(['ok' => true]);

        $this->getJson("/api/notifications/unread-count/{$other->id}")
            ->assertOk()
            ->assertJson(['count' => 0]);
    }

    private function createUser(string $accessLevel = 'standard', array $overrides = []): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => $overrides['email'] ?? sprintf('user%02d@example.test', $index),
            'fsc_code' => $overrides['fsc_code'] ?? sprintf('%05d', $index),
            'access_level' => $overrides['access_level'] ?? $accessLevel,
            'nickname' => $overrides['nickname'] ?? sprintf('User%02d', $index),
            'full_name' => $overrides['full_name'] ?? sprintf('Test User %02d', $index),
            'is_active' => $overrides['is_active'] ?? true,
        ]);
    }

    private function createNotification(array $overrides = []): int
    {
        $createdAt = $overrides['created_at'] ?? Carbon::parse('2026-02-25 10:00:00');
        $updatedAt = $overrides['updated_at'] ?? $createdAt;

        return (int) DB::table('notifications')->insertGetId([
            'title' => $overrides['title'] ?? 'Notification',
            'body' => $overrides['body'] ?? 'Body',
            'type' => $overrides['type'] ?? 'info',
            'created_by_id' => $overrides['created_by_id'] ?? null,
            'sent_at' => $overrides['sent_at'] ?? null,
            'created_at' => $createdAt,
            'updated_at' => $updatedAt,
        ]);
    }
}
