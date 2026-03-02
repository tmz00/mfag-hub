<?php

namespace Tests\Unit;

use Database\Seeders\LegacyImportClosingsSeeder;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class LegacyImportClosingsSeederTest extends TestCase
{
    public function test_parse_submitted_at_treats_legacy_timestamp_text_as_business_local_time(): void
    {
        config()->set('app.closing_filter_timezone', 'Asia/Singapore');

        $seeder = new LegacyImportClosingsSeeder();
        $method = new \ReflectionMethod($seeder, 'parseSubmittedAt');
        $method->setAccessible(true);

        $parsed = $method->invoke($seeder, [
            'timestamp' => '2024-05-09T21:46:51.789',
        ]);

        $this->assertIsArray($parsed);
        $this->assertInstanceOf(Carbon::class, $parsed['value']);
        $this->assertSame(
            '2024-05-09 13:46:51.789000 +00:00',
            $parsed['value']->copy()->utc()->format('Y-m-d H:i:s.u P')
        );
        $this->assertFalse($parsed['reconstructed']);
        $this->assertFalse($parsed['fallbackNow']);
    }

    public function test_parse_submitted_at_ignores_legacy_timezone_suffixes_and_preserves_literal_clock_time(): void
    {
        config()->set('app.closing_filter_timezone', 'Asia/Singapore');

        $seeder = new LegacyImportClosingsSeeder();
        $method = new \ReflectionMethod($seeder, 'parseSubmittedAt');
        $method->setAccessible(true);

        $parsed = $method->invoke($seeder, [
            'timestamp' => '2024-05-09T21:46:51.789-04:30',
        ]);

        $this->assertIsArray($parsed);
        $this->assertInstanceOf(Carbon::class, $parsed['value']);
        $this->assertSame(
            '2024-05-09 13:46:51.789000 +00:00',
            $parsed['value']->copy()->utc()->format('Y-m-d H:i:s.u P')
        );
        $this->assertFalse($parsed['reconstructed']);
        $this->assertFalse($parsed['fallbackNow']);
    }

    public function test_build_source_rows_applies_custom_source_order_and_keeps_assigned_items_active(): void
    {
        $seeder = new LegacyImportClosingsSeeder();
        $method = new \ReflectionMethod($seeder, 'buildSourceRows');
        $method->setAccessible(true);

        [
            $sourceRows,
            $sourceItemRows,
        ] = $method->invoke(
            $seeder,
            [
                ['source' => 'Cold', 'timestamp' => '2025-01-10T09:00:00.000'],
                ['source' => 'Referral', 'sourceComment' => 'Client Referral', 'timestamp' => '2025-01-04T09:00:00.000'],
                ['source' => 'Warm', 'sourceComment' => 'Expo Booth', 'timestamp' => '2025-01-06T09:00:00.000'],
                ['source' => 'Existing', 'sourceComment' => 'orphan follow-up', 'timestamp' => '2023-12-01T09:00:00.000'],
                ['source' => 'Seminar', 'timestamp' => '2025-01-08T09:00:00.000'],
                ['source' => 'Existing', 'timestamp' => '2025-01-12T09:00:00.000'],
                ['source' => 'Campaign', 'timestamp' => '2025-01-09T09:00:00.000'],
                ['source' => 'Warm', 'timestamp' => '2025-01-02T09:00:00.000'],
                ['source' => 'Warm', 'sourceComment' => 'social media', 'timestamp' => '2025-01-07T09:00:00.000'],
                ['source' => 'Existing', 'sourceComment' => 'aia call centre', 'timestamp' => '2025-01-11T09:00:00.000'],
            ],
            Carbon::create(2026, 1, 1, 0, 0, 0, 'UTC')
        );

        $this->assertSame(
            [
                'Warm',
                'Existing',
                'Assigned',
                'Referral',
                'Roadshow',
                'Social Media',
                'Seminar',
                'AIA Campaign',
                'Other (Cold)',
            ],
            array_map(static fn (array $row): string => (string) $row['label'], $sourceRows)
        );

        $assignedSourceId = (string) ($sourceRows[2]['id'] ?? '');
        $assignedItems = array_values(array_filter(
            $sourceItemRows,
            static fn (array $row): bool => (string) ($row['source_id'] ?? '') === $assignedSourceId
        ));

        $this->assertContains('Orphan Client', array_column($assignedItems, 'label'));
        $this->assertNotContains('Orphan Clients', array_column($assignedItems, 'label'));

        $orphanItem = array_values(array_filter(
            $assignedItems,
            static fn (array $row): bool => (string) ($row['label'] ?? '') === 'Orphan Client'
        ))[0] ?? null;
        $this->assertIsArray($orphanItem);
        $this->assertFalse((bool) ($orphanItem['is_deleted'] ?? true));

        $aiaCallCentreItem = array_values(array_filter(
            $assignedItems,
            static fn (array $row): bool => (string) ($row['label'] ?? '') === 'AIA Call Centre'
        ))[0] ?? null;
        $this->assertIsArray($aiaCallCentreItem);
        $this->assertFalse((bool) ($aiaCallCentreItem['is_deleted'] ?? true));
    }

    public function test_legacy_item_id_marks_top_level_standalone_riders(): void
    {
        $seeder = new LegacyImportClosingsSeeder();
        $method = new \ReflectionMethod($seeder, 'legacyItemIdMarksStandaloneRider');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke($seeder, 1000));
        $this->assertTrue($method->invoke($seeder, 1001));
        $this->assertTrue($method->invoke($seeder, ' 1002 '));
        $this->assertFalse($method->invoke($seeder, '999'));
        $this->assertFalse($method->invoke($seeder, 'R-1001'));
        $this->assertFalse($method->invoke($seeder, null));
    }
}
