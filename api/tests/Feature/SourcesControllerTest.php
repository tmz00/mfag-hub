<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SourcesControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_editor_can_update_referenced_sources_without_breaking_closings(): void
    {
        $editor = $this->createUser('editor');
        $owner = $this->createUser('standard');
        Sanctum::actingAs($editor);

        $this->seedSources([
            ['id' => 'warm', 'label' => 'Warm', 'children' => []],
            [
                'id' => 'roadshow',
                'label' => 'Roadshow',
                'children' => [
                    ['id' => 'expo', 'label' => 'Expo'],
                ],
            ],
        ]);
        $expoItemId = $this->findSourceItemId('roadshow', 'Expo');

        $warmClosingId = $this->createClosing($owner, 'warm');
        $roadshowClosingId = $this->createClosing($owner, 'roadshow', $expoItemId);

        $response = $this->putJson('/api/sources', [
            'sources' => [
                [
                    'id' => 'roadshow',
                    'label' => 'Roadshow Events',
                    'description' => 'Updated description',
                    'children' => [
                        ['id' => (string) $expoItemId, 'label' => 'Expo 2026'],
                        ['id' => null, 'label' => 'Summit'],
                    ],
                ],
                [
                    'id' => 'warm',
                    'label' => 'Warm Market',
                    'children' => [],
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('sources', [
            'id' => 'roadshow',
            'label' => 'Roadshow Events',
            'position' => 0,
        ]);
        $this->assertDatabaseHas('sources', [
            'id' => 'warm',
            'label' => 'Warm Market',
            'position' => 1,
        ]);
        $this->assertDatabaseHas('source_items', [
            'id' => $expoItemId,
            'label' => 'Expo 2026',
            'position' => 0,
        ]);
        $this->assertDatabaseHas('source_items', [
            'source_id' => 'roadshow',
            'label' => 'Summit',
            'position' => 1,
        ]);
        $this->assertDatabaseHas('closings', [
            'id' => $warmClosingId,
            'source_id' => 'warm',
            'source_item_id' => null,
        ]);
        $this->assertDatabaseHas('closings', [
            'id' => $roadshowClosingId,
            'source_id' => 'roadshow',
            'source_item_id' => $expoItemId,
        ]);
    }

    public function test_replace_soft_deletes_removed_source_used_by_closing(): void
    {
        $editor = $this->createUser('editor');
        $owner = $this->createUser('standard');
        Sanctum::actingAs($editor);

        $this->seedSources([
            ['id' => 'warm', 'label' => 'Warm', 'children' => []],
            ['id' => 'cold', 'label' => 'Cold', 'children' => []],
        ]);
        $this->createClosing($owner, 'warm');

        $response = $this->putJson('/api/sources', [
            'sources' => [
                ['id' => 'cold', 'label' => 'Cold', 'children' => []],
            ],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);
        $this->assertDatabaseHas('sources', ['id' => 'warm', 'label' => 'Warm', 'is_deleted' => true]);
        $this->assertDatabaseHas('sources', ['id' => 'cold', 'label' => 'Cold', 'is_deleted' => false]);
        $this->assertDatabaseHas('closings', ['source_id' => 'warm']);

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $snapshot = collect($history->json('snapshots'))
            ->first(fn ($row): bool => ($row['summary'] ?? null) === 'after deleting Warm');
        $this->assertIsArray($snapshot);

        $this->postJson('/api/backups/snapshots/' . $snapshot['id'] . '/restore')
            ->assertOk()
            ->assertJson(['restored' => true]);

        $this->assertDatabaseHas('sources', ['id' => 'warm', 'label' => 'Warm', 'is_deleted' => false]);
        $this->assertDatabaseHas('sources', ['id' => 'cold', 'label' => 'Cold', 'is_deleted' => false]);
    }

    public function test_replace_soft_deletes_removed_source_item_used_by_closing(): void
    {
        $editor = $this->createUser('editor');
        $owner = $this->createUser('standard');
        Sanctum::actingAs($editor);

        $this->seedSources([
            [
                'id' => 'roadshow',
                'label' => 'Roadshow',
                'children' => [
                    ['id' => 'expo', 'label' => 'Expo'],
                    ['id' => 'mall', 'label' => 'Mall'],
                ],
            ],
        ]);
        $expoItemId = $this->findSourceItemId('roadshow', 'Expo');
        $mallItemId = $this->findSourceItemId('roadshow', 'Mall');
        $this->createClosing($owner, 'roadshow', $expoItemId);

        $response = $this->putJson('/api/sources', [
            'sources' => [
                [
                    'id' => 'roadshow',
                    'label' => 'Roadshow',
                    'children' => [
                        ['id' => (string) $mallItemId, 'label' => 'Mall'],
                    ],
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);
        $this->assertDatabaseHas('source_items', [
            'id' => $expoItemId,
            'label' => 'Expo',
            'is_deleted' => true,
        ]);
        $this->assertDatabaseHas('source_items', [
            'id' => $mallItemId,
            'label' => 'Mall',
            'is_deleted' => false,
        ]);
        $this->assertDatabaseHas('closings', ['source_id' => 'roadshow', 'source_item_id' => $expoItemId]);
    }

    public function test_replace_allows_removing_unused_sources_and_items(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $this->seedSources([
            ['id' => 'warm', 'label' => 'Warm', 'children' => []],
            [
                'id' => 'roadshow',
                'label' => 'Roadshow',
                'children' => [
                    ['id' => 'expo', 'label' => 'Expo'],
                    ['id' => 'mall', 'label' => 'Mall'],
                ],
            ],
        ]);
        $expoItemId = $this->findSourceItemId('roadshow', 'Expo');
        $mallItemId = $this->findSourceItemId('roadshow', 'Mall');

        $response = $this->putJson('/api/sources', [
            'sources' => [
                [
                    'id' => 'roadshow',
                    'label' => 'Roadshow',
                    'children' => [
                        ['id' => (string) $mallItemId, 'label' => 'Mall'],
                    ],
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('sources', ['id' => 'warm', 'is_deleted' => true]);
        $this->assertDatabaseHas('source_items', [
            'id' => $expoItemId,
            'is_deleted' => true,
        ]);
        $this->assertDatabaseHas('sources', ['id' => 'roadshow', 'is_deleted' => false]);
        $this->assertDatabaseHas('source_items', [
            'id' => $mallItemId,
            'is_deleted' => false,
        ]);
    }

    public function test_index_can_include_deleted_source_items_for_legacy_reporting(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $this->seedSources([
            [
                'id' => 'roadshow',
                'label' => 'Roadshow',
                'children' => [
                    ['id' => 'expo', 'label' => 'Expo'],
                    ['id' => 'legacy', 'label' => 'Legacy Booth'],
                ],
            ],
        ]);

        $legacyItemId = $this->findSourceItemId('roadshow', 'Legacy Booth');
        DB::table('source_items')
            ->where('id', $legacyItemId)
            ->update(['is_deleted' => true]);

        $defaultResponse = $this->getJson('/api/sources');
        $defaultResponse->assertOk();

        $defaultChildren = $defaultResponse->json('sources.0.children');
        $this->assertSame([
            [
                'id' => (string) $this->findSourceItemId('roadshow', 'Expo'),
                'label' => 'Expo',
                'isDeleted' => false,
            ],
        ], $defaultChildren);

        $legacyResponse = $this->getJson('/api/sources?includeDeletedItems=1');
        $legacyResponse->assertOk();

        $legacyChildren = $legacyResponse->json('sources.0.children');
        $this->assertSame([
            [
                'id' => (string) $this->findSourceItemId('roadshow', 'Expo'),
                'label' => 'Expo',
                'isDeleted' => false,
            ],
            [
                'id' => (string) $legacyItemId,
                'label' => 'Legacy Booth',
                'isDeleted' => true,
            ],
        ], $legacyChildren);
    }

    private function createUser(string $accessLevel): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => sprintf('user%02d@example.test', $index),
            'fsc_code' => sprintf('FSC%05d', $index),
            'access_level' => $accessLevel,
            'nickname' => sprintf('User %02d', $index),
            'full_name' => sprintf('Test User %02d', $index),
            'is_active' => true,
        ]);
    }

    private function createClosing(User $owner, string $sourceId, ?int $sourceItemId = null): int
    {
        $now = now();
        return (int) DB::table('closings')->insertGetId([
            'submitted_at' => $now,
            'fsc_user_id' => $owner->id,
            'fsc_code' => $owner->fsc_code,
            'source_id' => $sourceId,
            'source_item_id' => $sourceItemId,
            'referrals' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function seedSources(array $sources): void
    {
        $now = now();
        $sourceRows = [];
        $itemRows = [];

        foreach (array_values($sources) as $sourcePosition => $source) {
            $sourceId = (string) $source['id'];
            $sourceRows[] = [
                'id' => $sourceId,
                'label' => (string) $source['label'],
                'description' => null,
                'position' => $sourcePosition,
                'is_deleted' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            $children = is_array($source['children'] ?? null) ? $source['children'] : [];
            foreach (array_values($children) as $childPosition => $child) {
                $itemRows[] = [
                    'source_id' => $sourceId,
                    'label' => (string) $child['label'],
                    'position' => $childPosition,
                    'is_deleted' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if (count($sourceRows) > 0) {
            DB::table('sources')->insert($sourceRows);
        }
        if (count($itemRows) > 0) {
            DB::table('source_items')->insert($itemRows);
        }
    }

    private function findSourceItemId(string $sourceId, string $label): int
    {
        $id = DB::table('source_items')
            ->where('source_id', $sourceId)
            ->where('label', $label)
            ->value('id');

        return (int) $id;
    }
}
