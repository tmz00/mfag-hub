<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class HandbookFileControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_editor_can_upload_list_download_and_delete_handbook_file(): void
    {
        Storage::fake('local');
        $editor = $this->createUser('editor', [
            'email' => 'editor-files@example.test',
            'fsc_code' => '41001',
            'nickname' => 'EditorFiles',
        ]);
        Sanctum::actingAs($editor);

        $file = UploadedFile::fake()->image('guide.png', 240, 180)->size(120);

        $uploadResponse = $this->postJson('/api/handbook/upload', ['file' => $file]);

        $uploadResponse->assertCreated()->assertJsonStructure([
            'id',
            'path',
            'name',
            'sizeBytes',
            'mimeType',
        ]);

        $id = (int) $uploadResponse->json('id');
        $path = (string) $uploadResponse->json('path');
        $name = (string) $uploadResponse->json('name');

        $this->assertGreaterThan(0, $id);
        $this->assertSame('guide.png', $name);
        $this->assertSame('handbook/guide.png', $path);
        Storage::disk('local')->assertExists($path);
        $this->assertDatabaseHas('handbook_files', [
            'id' => $id,
            'path' => $path,
            'mime_type' => 'image/png',
            'uploaded_by' => $editor->id,
        ]);

        $listResponse = $this->getJson('/api/handbook/files');
        $listResponse->assertOk();
        $listedIds = collect($listResponse->json('files'))
            ->map(static fn (array $row): int => (int) ($row['id'] ?? 0))
            ->all();
        $this->assertContains($id, $listedIds);

        $downloadResponse = $this->get("/api/handbook/file/{$id}");
        $downloadResponse->assertOk();
        $this->assertStringContainsString(
            'guide.png',
            (string) $downloadResponse->headers->get('content-disposition')
        );

        $deleteResponse = $this->deleteJson("/api/handbook/file/{$id}");
        $deleteResponse->assertOk()->assertJson(['deleted' => true]);
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('handbook_files', ['id' => $id]);
    }

    public function test_editor_can_delete_file_by_path_and_repeat_delete_is_idempotent(): void
    {
        Storage::fake('local');
        $editor = $this->createUser('editor', [
            'email' => 'editor-path@example.test',
            'fsc_code' => '42001',
            'nickname' => 'EditorPath',
        ]);
        Sanctum::actingAs($editor);

        $uploadResponse = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('guide.pdf', 80, 'application/pdf'),
        ]);
        $uploadResponse->assertCreated();
        $path = (string) $uploadResponse->json('path');

        $firstDeleteResponse = $this->deleteJson('/api/handbook/file', ['path' => $path]);
        $firstDeleteResponse->assertOk()->assertJson(['deleted' => true]);
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('handbook_files', ['path' => $path]);

        $secondDeleteResponse = $this->deleteJson('/api/handbook/file', ['path' => $path]);
        $secondDeleteResponse->assertOk()->assertJson(['deleted' => true]);
    }

    public function test_standard_user_cannot_upload_or_delete_handbook_files(): void
    {
        Storage::fake('local');
        $standard = $this->createUser('standard', [
            'email' => 'standard-files@example.test',
            'fsc_code' => '43001',
            'nickname' => 'StandardFiles',
        ]);
        Sanctum::actingAs($standard);

        $uploadResponse = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('blocked.pdf', 50, 'application/pdf'),
        ]);
        $uploadResponse->assertForbidden()->assertJson(['message' => 'Forbidden.']);

        $deleteByIdResponse = $this->deleteJson('/api/handbook/file/9999');
        $deleteByIdResponse->assertForbidden()->assertJson(['message' => 'Forbidden.']);

        $deleteByPathResponse = $this->deleteJson('/api/handbook/file', [
            'path' => 'handbook/blocked.pdf',
        ]);
        $deleteByPathResponse->assertForbidden()->assertJson(['message' => 'Forbidden.']);

        $listResponse = $this->getJson('/api/handbook/files');
        $listResponse->assertOk()->assertJson(['files' => []]);
    }

    public function test_uploads_with_duplicate_names_receive_incrementing_suffixes(): void
    {
        Storage::fake('local');
        $editor = $this->createUser('editor', [
            'email' => 'editor-dupe@example.test',
            'fsc_code' => '44001',
            'nickname' => 'EditorDupe',
        ]);
        Sanctum::actingAs($editor);

        $first = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('guide.pdf', 80, 'application/pdf'),
        ]);
        $second = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('guide.pdf', 85, 'application/pdf'),
        ]);

        $first->assertCreated()->assertJsonPath('path', 'handbook/guide.pdf');
        $first->assertJsonPath('name', 'guide.pdf');
        $second->assertCreated()->assertJsonPath('path', 'handbook/guide (2).pdf');
        $second->assertJsonPath('name', 'guide (2).pdf');

        Storage::disk('local')->assertExists('handbook/guide.pdf');
        Storage::disk('local')->assertExists('handbook/guide (2).pdf');
    }

    public function test_upload_keeps_original_filename_intact_when_it_is_safe(): void
    {
        Storage::fake('local');
        $editor = $this->createUser('editor', [
            'email' => 'editor-name@example.test',
            'fsc_code' => '44501',
            'nickname' => 'EditorName',
        ]);
        Sanctum::actingAs($editor);

        $response = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('Quarterly Report #1 (Final).PDF', 80, 'application/pdf'),
        ]);

        $response->assertCreated()->assertJsonPath(
            'path',
            'handbook/Quarterly Report #1 (Final).PDF'
        );
        $response->assertJsonPath('name', 'Quarterly Report #1 (Final).PDF');

        Storage::disk('local')->assertExists('handbook/Quarterly Report #1 (Final).PDF');
    }

    public function test_handbook_upload_is_rejected_when_shared_upload_quota_would_be_exceeded(): void
    {
        Storage::fake('local');
        config(['uploads.max_total_bytes' => 100 * 1024]);

        $editor = $this->createUser('editor', [
            'email' => 'editor-quota@example.test',
            'fsc_code' => '45001',
            'nickname' => 'EditorQuota',
        ]);
        Sanctum::actingAs($editor);

        $notificationId = (int) DB::table('notifications')->insertGetId([
            'title' => 'Quota Tracker',
            'body' => 'Existing usage',
            'created_by_id' => $editor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('notification_files')->insert([
            'notification_id' => $notificationId,
            'storage_path' => 'notifications/existing.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 70 * 1024,
            'uploaded_by_id' => $editor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/handbook/upload', [
            'file' => UploadedFile::fake()->create('guide.pdf', 40, 'application/pdf'),
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['file']);

        $this->assertDatabaseMissing('handbook_files', ['path' => 'handbook/guide.pdf']);
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
}
