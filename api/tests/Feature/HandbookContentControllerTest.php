<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class HandbookContentControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_view_handbook_content_in_position_order(): void
    {
        $viewer = $this->createUser('standard', [
            'email' => 'viewer@example.test',
            'fsc_code' => '10001',
            'nickname' => 'Viewer',
        ]);
        $updater = $this->createUser('editor', [
            'email' => 'updater@example.test',
            'fsc_code' => '10002',
            'nickname' => 'Updater Nick',
        ]);

        $older = Carbon::parse('2026-02-20 08:00:00', 'UTC');
        $newer = Carbon::parse('2026-02-21 10:30:00', 'UTC');

        DB::table('handbook_categories')->insert([
            [
                'category' => 'Second',
                'position' => 1,
                'content' => '<p>Second category</p>',
                'image_url' => 'https://cdn.example.test/second.webp',
                'image_path' => 'handbook/categories/second.webp',
                'is_deleted' => false,
                'updated_by' => $updater->id,
                'created_at' => $older,
                'updated_at' => $older,
            ],
            [
                'category' => 'First',
                'position' => 0,
                'content' => '<p>First category</p>',
                'image_url' => 'https://cdn.example.test/first.webp',
                'image_path' => 'handbook/categories/first.webp',
                'is_deleted' => false,
                'updated_by' => $updater->id,
                'created_at' => $newer,
                'updated_at' => $newer,
            ],
            [
                'category' => 'Hidden',
                'position' => 2,
                'content' => '<p>Hidden category</p>',
                'image_url' => null,
                'image_path' => null,
                'is_deleted' => true,
                'updated_by' => $updater->id,
                'created_at' => $newer,
                'updated_at' => $newer,
            ],
        ]);

        Sanctum::actingAs($viewer);

        $response = $this->getJson('/api/handbook/content');
        $response->assertOk()->assertJsonPath('name', 'handbook');

        $payload = $response->json('payload');
        $this->assertIsArray($payload);
        $this->assertCount(2, $payload);
        $this->assertSame(['First', 'Second'], array_column($payload, 'category'));
        $this->assertContainsOnly('integer', array_column($payload, 'id'));
        $this->assertSame('Updater Nick', $payload[0]['updatedBy']);
        $this->assertNotEmpty($payload[0]['updatedAt']);
        $this->assertTrue(
            Carbon::parse((string) $response->json('updatedAt'))->equalTo($newer)
        );
    }

    public function test_editor_can_replace_handbook_content_and_restore_from_snapshot(): void
    {
        $editor = $this->createUser('editor', [
            'email' => 'editor@example.test',
            'fsc_code' => '20001',
            'nickname' => 'Editor',
        ]);
        Sanctum::actingAs($editor);

        $keptId = (int) DB::table('handbook_categories')->insertGetId([
            'category' => 'Legacy Category',
            'position' => 0,
            'content' => '<p>Legacy</p>',
            'image_url' => null,
            'image_path' => null,
            'updated_by' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $removedId = (int) DB::table('handbook_categories')->insertGetId([
            'category' => 'Archived Category',
            'position' => 1,
            'content' => '<p>Archived</p>',
            'image_url' => null,
            'image_path' => null,
            'updated_by' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->putJson('/api/handbook/content', [
            'payload' => [
                [
                    'id' => $keptId,
                    'category' => '  Legacy Updated  ',
                    'content' => '<p>Alpha</p>',
                    'imageUrl' => '',
                    'imagePath' => ' ',
                ],
                [
                    'category' => '  Investments  ',
                    'content' => '<p>Beta</p>',
                    'imageUrl' => ' https://cdn.example.test/beta.webp ',
                    'imagePath' => ' handbook/categories/beta.webp ',
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['success' => true]);
        $this->assertNotNull($response->json('updatedAt'));
        $this->assertDatabaseHas('handbook_categories', [
            'id' => $keptId,
            'category' => 'Legacy Updated',
            'content' => '<p>Alpha</p>',
            'is_deleted' => false,
            'updated_by' => $editor->id,
        ]);
        $this->assertDatabaseHas('handbook_categories', [
            'id' => $removedId,
            'category' => 'Archived Category',
            'is_deleted' => true,
        ]);

        $rows = DB::table('handbook_categories')
            ->where('is_deleted', false)
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $this->assertCount(2, $rows);

        $first = $rows[0];
        $this->assertSame($keptId, (int) $first->id);
        $this->assertSame('Legacy Updated', $first->category);
        $this->assertSame('<p>Alpha</p>', $first->content);
        $this->assertNull($first->image_url);
        $this->assertNull($first->image_path);
        $this->assertSame($editor->id, (int) $first->updated_by);

        $second = $rows[1];
        $this->assertSame('Investments', $second->category);
        $this->assertSame('<p>Beta</p>', $second->content);
        $this->assertSame('https://cdn.example.test/beta.webp', $second->image_url);
        $this->assertSame('handbook/categories/beta.webp', $second->image_path);
        $this->assertSame($editor->id, (int) $second->updated_by);

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $snapshot = collect($history->json('snapshots'))
            ->first(fn ($row): bool => ($row['feature'] ?? null) === 'handbook');
        $this->assertIsArray($snapshot);
        $this->assertSame(
            "after adding Investments",
            $snapshot['summary'] ?? null
        );

        $this->postJson('/api/backups/snapshots/' . $snapshot['id'] . '/restore')
            ->assertOk()
            ->assertJson(['restored' => true]);

        $this->assertDatabaseHas('handbook_categories', [
            'id' => $removedId,
            'category' => 'Archived Category',
            'is_deleted' => false,
        ]);
        $this->assertDatabaseHas('handbook_categories', [
            'category' => 'Investments',
            'is_deleted' => true,
        ]);
    }

    public function test_standard_user_cannot_update_handbook_content(): void
    {
        $standard = $this->createUser('standard', [
            'email' => 'standard@example.test',
            'fsc_code' => '30001',
            'nickname' => 'Standard',
        ]);
        Sanctum::actingAs($standard);

        DB::table('handbook_categories')->insert([
            'category' => 'Existing Category',
            'position' => 0,
            'content' => '<p>Existing</p>',
            'image_url' => null,
            'image_path' => null,
            'updated_by' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->putJson('/api/handbook/content', [
            'payload' => [
                [
                    'category' => 'Blocked Update',
                    'content' => '<p>Should fail</p>',
                ],
            ],
        ]);

        $response->assertForbidden()->assertJson(['message' => 'Forbidden.']);
        $this->assertDatabaseHas('handbook_categories', [
            'category' => 'Existing Category',
        ]);
        $this->assertDatabaseMissing('handbook_categories', [
            'category' => 'Blocked Update',
        ]);
    }

    public function test_editor_update_cleans_up_unreferenced_handbook_files(): void
    {
        Storage::fake('local');

        $editor = $this->createUser('editor', [
            'email' => 'cleanup@example.test',
            'fsc_code' => '30002',
            'nickname' => 'Cleanup Editor',
        ]);
        Sanctum::actingAs($editor);

        Storage::disk('local')->put('handbook/guide.pdf', 'guide');
        Storage::disk('local')->put('handbook/categories/cover.webp', 'cover');
        Storage::disk('local')->put('handbook/old-video.mp4', 'old');

        $keptDocumentId = (int) DB::table('handbook_files')->insertGetId([
            'path' => 'handbook/guide.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 5,
            'uploaded_by' => $editor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $keptImageId = (int) DB::table('handbook_files')->insertGetId([
            'path' => 'handbook/categories/cover.webp',
            'mime_type' => 'image/webp',
            'size_bytes' => 5,
            'uploaded_by' => $editor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $staleFileId = (int) DB::table('handbook_files')->insertGetId([
            'path' => 'handbook/old-video.mp4',
            'mime_type' => 'video/mp4',
            'size_bytes' => 3,
            'uploaded_by' => $editor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->putJson('/api/handbook/content', [
            'payload' => [
                [
                    'category' => 'Claims',
                    'content' => sprintf(
                        '<p><a href="/api/handbook/file/%d">Guide</a></p>',
                        $keptDocumentId
                    ),
                    'imageUrl' => sprintf('/api/handbook/file/%d', $keptImageId),
                    'imagePath' => 'handbook/categories/cover.webp',
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['success' => true]);

        $this->assertDatabaseHas('handbook_files', ['id' => $keptDocumentId]);
        $this->assertDatabaseHas('handbook_files', ['id' => $keptImageId]);
        $this->assertDatabaseMissing('handbook_files', ['id' => $staleFileId]);

        Storage::disk('local')->assertExists('handbook/guide.pdf');
        Storage::disk('local')->assertExists('handbook/categories/cover.webp');
        Storage::disk('local')->assertMissing('handbook/old-video.mp4');
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
