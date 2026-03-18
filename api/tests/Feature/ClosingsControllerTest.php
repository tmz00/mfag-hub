<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClosingsControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_and_index_round_trip_submit_closing_payload(): void
    {
        $owner = $this->createUser('standard');
        $shared = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');

        Sanctum::actingAs($owner);

        $response = $this->postJson('/api/closings', $this->validClosingPayload($owner->fsc_code, [
            'sharedFscCode' => $shared->fsc_code,
            'isShared' => true,
            'sourceComment' => 'Roadshow booth',
            'referrals' => 3,
            'referralsComment' => 'Two pending',
            'items' => [
                [
                    'productId' => 'PLAN-1',
                    'fullName' => 'Starter Plan',
                    'shortName' => 'Starter',
                    'premiumTermOrIssueAge' => '20 years',
                    'type' => 'regular',
                    'fycRate' => 12.5,
                    'gst' => 9,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 2,
                            'premium' => 150.55,
                            'frequency' => 'Annual',
                        ],
                        [
                            'quantity' => 1,
                            'premium' => 150.55,
                            'frequency' => 'Annual',
                        ],
                        [
                            'quantity' => 1,
                            'premium' => 0,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [
                        [
                            'productId' => 'RIDER-1',
                            'fullName' => 'Booster Rider',
                            'shortName' => 'Booster',
                            'fycRate' => 4,
                            'gst' => 0,
                            'quantitiesAndPremiums' => [
                                [
                                    'quantity' => 1,
                                    'premium' => 50,
                                    'frequency' => 'Annual',
                                ],
                            ],
                            'riders' => [],
                        ],
                    ],
                ],
                [
                    'productId' => '',
                    'fullName' => 'Ignored Product',
                    'shortName' => 'Ignored',
                    'fycRate' => 1,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [],
                    'riders' => [],
                ],
            ],
        ]));

        $response->assertCreated();
        $closingId = (int) $response->json('id');

        $this->assertDatabaseHas('closings', [
            'id' => $closingId,
            'fsc_user_id' => $owner->id,
            'shared_fsc_user_id' => $shared->id,
            'is_shared' => true,
            'source_id' => 'warm',
            'referrals' => 3,
        ]);
        $this->assertDatabaseCount('closing_items', 2);
        $this->assertDatabaseCount('closing_item_premiums', 2);

        $indexed = $this->getJson('/api/closings?startDate=2026-02-01T00:00:00Z&endDate=2026-03-01T00:00:00Z');
        $indexed->assertOk()->assertJsonCount(1, 'closings');

        $closing = $indexed->json('closings.0');
        $this->assertIsArray($closing);
        $this->assertSame((string) $closingId, $closing['id']);
        $this->assertSame($owner->fsc_code, $closing['fscCode']);
        $this->assertSame($owner->nickname, $closing['fscName']);
        $this->assertTrue($closing['isShared']);
        $this->assertSame($shared->fsc_code, $closing['sharedFscCode']);
        $this->assertSame($shared->nickname, $closing['sharedFscName']);
        $this->assertSame('warm', $closing['sourceId']);
        $this->assertSame('Warm', $closing['sourceLabel']);
        $this->assertSame('Roadshow booth', $closing['sourceComment']);
        $this->assertSame(3, $closing['referrals']);
        $this->assertSame('Two pending', $closing['referralsComment']);
        $this->assertSame($owner->nickname, $closing['updatedBy']);
        $this->assertCount(1, $closing['items']);
        $this->assertSame('PLAN-1', $closing['items'][0]['productId']);
        $this->assertFalse($closing['items'][0]['isRider']);
        $this->assertSame('Starter Plan', $closing['items'][0]['fullName']);
        $this->assertSame('20 years', $closing['items'][0]['premiumTermOrIssueAge']);
        $this->assertSame('regular', $closing['items'][0]['type']);
        $this->assertCount(1, $closing['items'][0]['quantitiesAndPremiums']);
        $this->assertSame(3, $closing['items'][0]['quantitiesAndPremiums'][0]['quantity']);
        $this->assertSame(150.55, $closing['items'][0]['quantitiesAndPremiums'][0]['premium']);
        $this->assertCount(1, $closing['items'][0]['riders']);
        $this->assertSame('RIDER-1', $closing['items'][0]['riders'][0]['productId']);
        $this->assertTrue($closing['items'][0]['riders'][0]['isRider']);

        $filtered = $this->getJson('/api/closings?startDate=2026-02-01T00:00:00Z&endDate=2026-03-01T00:00:00Z&fscCode=' . urlencode($shared->fsc_code));
        $filtered->assertOk();

        $this->assertSame(
            [(string) $closingId],
            collect($filtered->json('closings'))->pluck('id')->all()
        );
    }

    public function test_store_marks_top_level_standalone_riders_as_riders(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        $this->seedProduct('RIDER-STANDALONE', true, 'Catalog Rider');

        Sanctum::actingAs($owner);

        $response = $this->postJson('/api/closings', $this->validClosingPayload($owner->fsc_code, [
            'items' => [
                [
                    'productId' => 'RIDER-STANDALONE',
                    'fullName' => 'Catalog Rider',
                    'shortName' => 'Add On Catalog Rider',
                    'fycRate' => 8,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 1,
                            'premium' => 80,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
                [
                    'productId' => 'custom-addon',
                    'fullName' => 'Custom Add On',
                    'shortName' => 'Add On Custom',
                    'isRider' => true,
                    'fycRate' => 5,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 2,
                            'premium' => 25,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
            ],
        ]));

        $response->assertCreated();
        $closingId = (int) $response->json('id');

        $this->assertDatabaseHas('closing_items', [
            'closing_id' => $closingId,
            'product_id' => 'RIDER-STANDALONE',
            'is_rider' => true,
        ]);
        $this->assertDatabaseHas('closing_items', [
            'closing_id' => $closingId,
            'product_id' => 'custom-addon',
            'is_rider' => true,
        ]);

        $show = $this->getJson("/api/closings/{$closingId}");
        $show->assertOk()->assertJsonPath('closing.items.0.isRider', true);
        $show->assertOk()->assertJsonPath('closing.items.1.isRider', true);
    }

    public function test_store_only_consolidates_duplicate_premium_rows_within_each_item(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');

        Sanctum::actingAs($owner);

        $response = $this->postJson('/api/closings', $this->validClosingPayload($owner->fsc_code, [
            'items' => [
                [
                    'productId' => 'PLAN-OPT',
                    'fullName' => 'Option Plan',
                    'shortName' => 'Option Plan',
                    'premiumTermOrIssueAge' => '20 years',
                    'fycRate' => 10,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 1,
                            'premium' => 100,
                            'frequency' => 'Annual',
                        ],
                        [
                            'quantity' => 2,
                            'premium' => 100,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
                [
                    'productId' => 'PLAN-OPT',
                    'fullName' => 'Option Plan',
                    'shortName' => 'Option Plan',
                    'premiumTermOrIssueAge' => '25 years',
                    'fycRate' => 10,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 3,
                            'premium' => 100,
                            'frequency' => 'Annual',
                        ],
                        [
                            'quantity' => 1,
                            'premium' => 100,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
            ],
        ]));

        $response->assertCreated();
        $closingId = (int) $response->json('id');

        $this->assertDatabaseCount('closing_items', 2);
        $this->assertDatabaseCount('closing_item_premiums', 2);

        $show = $this->getJson("/api/closings/{$closingId}");
        $show->assertOk();
        $this->assertCount(2, $show->json('closing.items'));
        $this->assertSame('20 years', $show->json('closing.items.0.premiumTermOrIssueAge'));
        $this->assertSame([
            [
                'quantity' => 3,
                'premium' => 100,
                'frequency' => 'Annual',
            ],
        ], $show->json('closing.items.0.quantitiesAndPremiums'));
        $this->assertSame('25 years', $show->json('closing.items.1.premiumTermOrIssueAge'));
        $this->assertSame([
            [
                'quantity' => 4,
                'premium' => 100,
                'frequency' => 'Annual',
            ],
        ], $show->json('closing.items.1.quantitiesAndPremiums'));
    }

    public function test_store_consolidates_duplicate_items_with_same_identity_into_one_item(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');

        Sanctum::actingAs($owner);

        $response = $this->postJson('/api/closings', $this->validClosingPayload($owner->fsc_code, [
            'items' => [
                [
                    'productId' => '63',
                    'fullName' => 'Pro Lifetime Protector (II)',
                    'shortName' => 'PLP',
                    'premiumTermOrIssueAge' => '0 - 60',
                    'fycRate' => 50,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 1,
                            'premium' => 3600,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
                [
                    'productId' => '63',
                    'fullName' => 'Pro Lifetime Protector (II)',
                    'shortName' => 'PLP',
                    'premiumTermOrIssueAge' => '0 - 60',
                    'fycRate' => 50,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 1,
                            'premium' => 4000,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
            ],
        ]));

        $response->assertCreated();
        $closingId = (int) $response->json('id');

        $this->assertDatabaseCount('closing_items', 1);
        $this->assertDatabaseCount('closing_item_premiums', 2);

        $show = $this->getJson("/api/closings/{$closingId}");
        $show->assertOk();
        $this->assertCount(1, $show->json('closing.items'));
        $this->assertSame([
            [
                'quantity' => 1,
                'premium' => 3600,
                'frequency' => 'Annual',
            ],
            [
                'quantity' => 1,
                'premium' => 4000,
                'frequency' => 'Annual',
            ],
        ], $show->json('closing.items.0.quantitiesAndPremiums'));
    }

    public function test_standard_users_cannot_update_or_delete_unowned_closings(): void
    {
        $owner = $this->createUser('standard');
        $outsider = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        $closingId = $this->insertClosing($owner);

        Sanctum::actingAs($outsider);

        $this->putJson("/api/closings/{$closingId}", $this->validClosingPayload($owner->fsc_code, [
            'referrals' => 4,
        ]))->assertForbidden();

        $this->deleteJson("/api/closings/{$closingId}")->assertForbidden();

        $this->assertDatabaseHas('closings', [
            'id' => $closingId,
            'fsc_user_id' => $owner->id,
        ]);
    }

    public function test_index_interprets_date_only_filters_in_business_timezone(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        Sanctum::actingAs($owner);

        $excludedId = $this->insertClosing($owner, [
            'submitted_at' => Carbon::parse('2026-02-28 15:30:00', 'UTC'),
        ]);
        $includedId = $this->insertClosing($owner, [
            'submitted_at' => Carbon::parse('2026-02-28 16:30:00', 'UTC'),
        ]);

        $response = $this->getJson('/api/closings?startDate=2026-03-01&endDate=2026-03-01');

        $response->assertOk()->assertJsonCount(1, 'closings');
        $this->assertSame(
            [(string) $includedId],
            collect($response->json('closings'))->pluck('id')->all()
        );
        $this->assertNotSame((string) $excludedId, $response->json('closings.0.id'));
    }

    public function test_show_consolidates_legacy_duplicate_premium_rows(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        Sanctum::actingAs($owner);

        $closingId = $this->insertClosing($owner, [
            'premium_rows' => [
                [
                    'quantity' => 1,
                    'premium' => 100,
                    'frequency' => 'Annual',
                ],
                [
                    'quantity' => 2,
                    'premium' => 100,
                    'frequency' => 'Annual',
                ],
                [
                    'quantity' => 1,
                    'premium' => 50,
                    'frequency' => 'Quarterly',
                ],
            ],
        ]);

        $response = $this->getJson("/api/closings/{$closingId}");

        $response->assertOk();
        $this->assertSame([
            [
                'quantity' => 3,
                'premium' => 100,
                'frequency' => 'Annual',
            ],
            [
                'quantity' => 1,
                'premium' => 50,
                'frequency' => 'Quarterly',
            ],
        ], $response->json('closing.items.0.quantitiesAndPremiums'));
    }

    public function test_show_consolidates_legacy_duplicate_items_with_same_identity(): void
    {
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        Sanctum::actingAs($owner);

        $closingId = $this->insertClosing($owner, [
            'premium_rows' => [
                [
                    'quantity' => 1,
                    'premium' => 3600,
                    'frequency' => 'Annual',
                ],
            ],
        ]);

        $now = now();
        $duplicateItemId = DB::table('closing_items')->insertGetId([
            'closing_id' => $closingId,
            'parent_item_id' => null,
            'is_rider' => false,
            'product_id' => 'PLAN-BASE',
            'full_name' => 'Base Plan',
            'short_name' => 'Base',
            'premium_term_or_issue_age' => null,
            'type_key' => 'regular',
            'fyc_rate' => 10,
            'gst' => 0,
            'position' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('closing_item_premiums')->insert([
            'closing_item_id' => $duplicateItemId,
            'quantity' => 1,
            'premium' => 4000,
            'frequency' => 'Annual',
            'position' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->getJson("/api/closings/{$closingId}");

        $response->assertOk();
        $this->assertCount(1, $response->json('closing.items'));
        $this->assertSame([
            [
                'quantity' => 1,
                'premium' => 3600,
                'frequency' => 'Annual',
            ],
            [
                'quantity' => 1,
                'premium' => 4000,
                'frequency' => 'Annual',
            ],
        ], $response->json('closing.items.0.quantitiesAndPremiums'));
    }

    public function test_admin_can_replace_month_data_and_read_backups(): void
    {
        $admin = $this->createUser('admin');
        $owner = $this->createUser('standard');
        $this->seedSource('warm', 'Warm');
        $originalId = $this->insertClosing($owner, [
            'submitted_at' => Carbon::parse('2026-02-10 10:15:00'),
        ]);

        Sanctum::actingAs($admin);

        $replacement = [
            [
                'timestamp' => '2026-03-15T08:00:00Z',
                'fscCode' => $owner->fsc_code,
                'sourceId' => 'warm',
                'referrals' => 1,
                'items' => [
                    [
                        'productId' => 'PLAN-NEW',
                        'fullName' => 'Replacement Plan',
                        'shortName' => 'RP',
                        'fycRate' => 8,
                        'gst' => 0,
                        'quantitiesAndPremiums' => [
                            [
                                'quantity' => 1,
                                'premium' => 88,
                                'frequency' => 'Annual',
                            ],
                        ],
                        'riders' => [],
                    ],
                ],
            ],
        ];

        $this->putJson('/api/closings/months/202602/data', [
            'data' => json_encode($replacement, JSON_UNESCAPED_UNICODE),
        ])->assertOk()->assertJson([
            'saved' => true,
        ]);

        $this->assertDatabaseMissing('closings', [
            'id' => $originalId,
        ]);
        $this->assertDatabaseCount('closings', 1);
        $this->assertDatabaseCount('closing_month_backups', 1);

        $replacementClosing = DB::table('closings')->first();
        $this->assertNotNull($replacementClosing);
        $this->assertSame($owner->id, (int) $replacementClosing->fsc_user_id);

        $submittedAt = Carbon::parse((string) $replacementClosing->submitted_at);
        $this->assertSame('2026-02-01 12:00', $submittedAt->format('Y-m-d H:i'));

        $backups = $this->getJson('/api/closings/months/202602/backups');
        $backups->assertOk()->assertJsonCount(1, 'backups');

        $export = $this->getJson('/api/closings/months/202602/data');
        $export->assertOk();

        $decoded = json_decode((string) $export->json('data'), true);
        $this->assertIsArray($decoded);
        $this->assertCount(1, $decoded);
        $this->assertArrayNotHasKey('id', $decoded[0]);
        $this->assertSame('PLAN-NEW', $decoded[0]['items'][0]['productId']);
    }

    private function createUser(string $accessLevel): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => sprintf('closing-user%02d@example.test', $index),
            'fsc_code' => sprintf('C%05d', $index),
            'access_level' => $accessLevel,
            'nickname' => sprintf('Closing User %02d', $index),
            'full_name' => sprintf('Closing Test User %02d', $index),
            'is_active' => true,
        ]);
    }

    private function seedSource(string $id, string $label): void
    {
        DB::table('sources')->insert([
            'id' => $id,
            'label' => $label,
            'position' => 0,
            'is_deleted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedProduct(string $id, bool $isRider, string $fullName): void
    {
        DB::table('products')->insert([
            'id' => $id,
            'is_rider' => $isRider,
            'is_deleted' => false,
            'category' => null,
            'full_name' => $fullName,
            'short_name' => $fullName,
            'type_key' => null,
            'notes' => null,
            'option_title' => null,
            'fyc_rate' => null,
            'frequency_mask' => 0,
            'gst' => null,
            'position' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function validClosingPayload(string $fscCode, array $overrides = []): array
    {
        $base = [
            'timestamp' => '2026-02-15T08:30:00Z',
            'fscCode' => $fscCode,
            'sourceId' => 'warm',
            'referrals' => 1,
            'items' => [
                [
                    'productId' => 'PLAN-BASE',
                    'fullName' => 'Base Plan',
                    'shortName' => 'Base',
                    'fycRate' => 10,
                    'gst' => 0,
                    'quantitiesAndPremiums' => [
                        [
                            'quantity' => 1,
                            'premium' => 100,
                            'frequency' => 'Annual',
                        ],
                    ],
                    'riders' => [],
                ],
            ],
        ];

        return array_replace_recursive($base, $overrides);
    }

    private function insertClosing(User $owner, array $overrides = []): int
    {
        $now = now();
        $closingId = DB::table('closings')->insertGetId([
            'submitted_at' => $overrides['submitted_at'] ?? Carbon::parse('2026-02-15 08:30:00'),
            'fsc_user_id' => $owner->id,
            'fsc_code' => $owner->fsc_code,
            'fsc_agency_code' => null,
            'is_shared' => false,
            'shared_fsc_user_id' => null,
            'shared_fsc_code' => null,
            'shared_fsc_agency_code' => null,
            'source_id' => 'warm',
            'source_item_id' => null,
            'source_comment' => null,
            'referrals' => 1,
            'referrals_comment' => null,
            'created_by' => $owner->id,
            'updated_by' => $owner->id,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $premiumRows = $overrides['premium_rows'] ?? [
            [
                'quantity' => 1,
                'premium' => 100,
                'frequency' => 'Annual',
            ],
        ];

        $itemId = DB::table('closing_items')->insertGetId([
            'closing_id' => $closingId,
            'parent_item_id' => null,
            'is_rider' => false,
            'product_id' => 'PLAN-BASE',
            'full_name' => 'Base Plan',
            'short_name' => 'Base',
            'premium_term_or_issue_age' => null,
            'type_key' => 'regular',
            'fyc_rate' => 10,
            'gst' => 0,
            'position' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        foreach (array_values($premiumRows) as $position => $premiumRow) {
            DB::table('closing_item_premiums')->insert([
                'closing_item_id' => $itemId,
                'quantity' => max(1, (int) ($premiumRow['quantity'] ?? 1)),
                'premium' => $premiumRow['premium'] ?? 0,
                'frequency' => $premiumRow['frequency'] ?? null,
                'position' => $position,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        return (int) $closingId;
    }
}
