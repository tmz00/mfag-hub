<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductCatalogControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_excludes_soft_deleted_products(): void
    {
        $viewer = $this->createUser('standard');
        Sanctum::actingAs($viewer);

        $now = now();
        DB::table('product_type_definitions')->insert([
            [
                'type_key' => 'regular',
                'label' => 'Regular',
                'position' => 0,
                'is_deleted' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'type_key' => 'legacy',
                'label' => 'Legacy',
                'position' => 1,
                'is_deleted' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        DB::table('products')->insert([
            [
                'id' => 'BP-ACTIVE',
                'is_rider' => false,
                'is_deleted' => false,
                'full_name' => 'Active Base Plan',
                'position' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 'BP-DELETED',
                'is_rider' => false,
                'is_deleted' => true,
                'full_name' => 'Deleted Base Plan',
                'position' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 'R-ACTIVE',
                'is_rider' => true,
                'is_deleted' => false,
                'full_name' => 'Active Rider',
                'position' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 'R-DELETED',
                'is_rider' => true,
                'is_deleted' => true,
                'full_name' => 'Deleted Rider',
                'position' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        $response = $this->getJson('/api/products');
        $response->assertOk();

        $baseIds = collect($response->json('basePlans'))->pluck('id')->all();
        $riderIds = collect($response->json('riders'))->pluck('id')->all();
        $types = $response->json('types');

        $this->assertSame(['BP-ACTIVE'], $baseIds);
        $this->assertSame(['R-ACTIVE'], $riderIds);
        $this->assertSame(['regular' => 'Regular'], $types);
    }

    public function test_update_soft_deletes_removed_type_definitions_and_restores_them_from_snapshot(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $now = now();
        DB::table('product_type_definitions')->insert([
            [
                'type_key' => 'regular',
                'label' => 'Regular',
                'position' => 0,
                'is_deleted' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'type_key' => 'legacy',
                'label' => 'Legacy',
                'position' => 1,
                'is_deleted' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        $this->putJson('/api/products', [
            'gst' => 9,
            'types' => [
                'regular' => 'Regular',
            ],
            'basePlans' => [],
            'riders' => [],
        ])->assertOk()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('product_type_definitions', [
            'type_key' => 'regular',
            'is_deleted' => false,
        ]);
        $this->assertDatabaseHas('product_type_definitions', [
            'type_key' => 'legacy',
            'label' => 'Legacy',
            'is_deleted' => true,
        ]);

        $visible = $this->getJson('/api/products');
        $visible->assertOk();
        $this->assertSame(['regular' => 'Regular'], $visible->json('types'));

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $snapshot = collect($history->json('snapshots'))
            ->first(fn ($row): bool => ($row['summary'] ?? null) === 'after editing GST / type definitions');
        $this->assertIsArray($snapshot);

        $this->postJson('/api/backups/snapshots/' . $snapshot['id'] . '/restore')
            ->assertOk()
            ->assertJson(['restored' => true]);

        $this->assertDatabaseHas('product_type_definitions', [
            'type_key' => 'legacy',
            'label' => 'Legacy',
            'is_deleted' => false,
        ]);

        $visibleAfterUndo = $this->getJson('/api/products');
        $visibleAfterUndo->assertOk();
        $this->assertSame([
            'regular' => 'Regular',
            'legacy' => 'Legacy',
        ], $visibleAfterUndo->json('types'));
    }

    public function test_update_soft_deletes_products_missing_from_payload(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $now = now();
        DB::table('products')->insert([
            [
                'id' => 'BASE-1',
                'is_rider' => false,
                'is_deleted' => false,
                'full_name' => 'Base Before',
                'position' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 'BASE-LEGACY',
                'is_rider' => false,
                'is_deleted' => false,
                'full_name' => 'Legacy Base',
                'position' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => 'RIDER-OLD',
                'is_rider' => true,
                'is_deleted' => false,
                'full_name' => 'Old Rider',
                'position' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        $response = $this->putJson('/api/products', [
            'gst' => 9,
            'types' => [
                'regular' => 'Regular',
            ],
            'riders' => [
                [
                    'id' => 'RIDER-NEW',
                    'category' => 'Protection',
                    'fullName' => 'New Rider',
                    'shortName' => 'NR',
                    'type' => 'regular',
                    'frequencies' => ['Annual'],
                    'options' => [
                        ['label' => 'Option A', 'fycRate' => '12'],
                    ],
                ],
            ],
            'basePlans' => [
                [
                    'id' => 'BASE-1',
                    'category' => 'Life',
                    'fullName' => 'Base After',
                    'shortName' => 'BA',
                    'type' => 'regular',
                    'frequencies' => ['Annual'],
                    'attachableRiders' => ['RIDER-NEW', 'RIDER-OLD'],
                ],
            ],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('products', [
            'id' => 'BASE-1',
            'is_deleted' => false,
            'full_name' => 'Base After',
        ]);
        $this->assertDatabaseHas('products', [
            'id' => 'RIDER-NEW',
            'is_deleted' => false,
            'full_name' => 'New Rider',
        ]);
        $this->assertDatabaseHas('products', [
            'id' => 'RIDER-OLD',
            'is_deleted' => true,
        ]);
        $this->assertDatabaseHas('products', [
            'id' => 'BASE-LEGACY',
            'is_deleted' => true,
        ]);

        $this->assertDatabaseHas('product_attachable_riders', [
            'base_product_id' => 'BASE-1',
            'rider_id' => 'RIDER-NEW',
        ]);
        $this->assertDatabaseMissing('product_attachable_riders', [
            'base_product_id' => 'BASE-1',
            'rider_id' => 'RIDER-OLD',
        ]);

        $visible = $this->getJson('/api/products');
        $visible->assertOk();

        $baseIds = collect($visible->json('basePlans'))->pluck('id')->all();
        $riderIds = collect($visible->json('riders'))->pluck('id')->all();
        $this->assertSame(['BASE-1'], $baseIds);
        $this->assertSame(['RIDER-NEW'], $riderIds);

        $history = $this->getJson('/api/backups/snapshots');
        $history->assertOk();

        $snapshot = collect($history->json('snapshots'))
            ->first(fn ($row): bool => ($row['feature'] ?? null) === 'products');
        $this->assertIsArray($snapshot);

        $this->postJson('/api/backups/snapshots/' . $snapshot['id'] . '/restore')
            ->assertOk()
            ->assertJson(['restored' => true]);

        $this->assertDatabaseHas('products', [
            'id' => 'BASE-LEGACY',
            'is_deleted' => false,
            'full_name' => 'Legacy Base',
        ]);
        $this->assertDatabaseHas('products', [
            'id' => 'RIDER-NEW',
            'is_deleted' => true,
        ]);
    }

    public function test_update_reactivates_previously_soft_deleted_product_with_same_id(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $now = now();
        DB::table('products')->insert([
            'id' => 'BASE-RESTORE',
            'is_rider' => false,
            'is_deleted' => true,
            'full_name' => 'Old Deleted Name',
            'position' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->putJson('/api/products', [
            'types' => [
                'regular' => 'Regular',
            ],
            'basePlans' => [
                [
                    'id' => 'BASE-RESTORE',
                    'category' => 'Life',
                    'fullName' => 'Restored Base Plan',
                    'type' => 'regular',
                    'frequencies' => ['Annual'],
                ],
            ],
            'riders' => [],
        ]);

        $response->assertOk()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('products', [
            'id' => 'BASE-RESTORE',
            'is_deleted' => false,
            'full_name' => 'Restored Base Plan',
        ]);
    }

    public function test_update_uses_custom_snapshot_title_when_provided(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $this->putJson('/api/products', [
            'snapshotTitle' => 'Reorder Categories / Products',
            'types' => [],
            'basePlans' => [],
            'riders' => [],
        ])->assertOk()->assertJson(['saved' => true]);

        $snapshot = DB::table('admin_restore_snapshots')
            ->where('feature', 'products')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($snapshot);
        $this->assertSame('after reordering categories / products', $snapshot->summary);
    }

    private function createUser(string $accessLevel): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => sprintf('product-user%02d@example.test', $index),
            'fsc_code' => sprintf('P%05d', $index),
            'access_level' => $accessLevel,
            'nickname' => sprintf('Product User %02d', $index),
            'full_name' => sprintf('Product Test User %02d', $index),
            'is_active' => true,
        ]);
    }
}
