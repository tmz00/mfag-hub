<?php

namespace Tests\Unit;

use App\Models\HandbookCategory;
use App\Services\Handbook\HandbookSearchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HandbookSearchServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_returns_section_matches_with_following_context_lines(): void
    {
        $category = HandbookCategory::query()->create([
            'category' => 'Claims',
            'position' => 0,
            'content' => '<h2>Claims Checklist</h2><details><summary>Eligibility Rules</summary><p>Waiver applies after ninety days. Contact support for forms.</p><p>Bring identification before submitting claims.</p></details>',
            'is_deleted' => false,
        ]);

        $results = app(HandbookSearchService::class)->search('eligibility');

        $this->assertCount(1, $results);
        $this->assertSame($category->id, $results[0]['categoryId']);
        $this->assertSame('Claims', $results[0]['category']);
        $this->assertSame('Claims Checklist', $results[0]['h2']);
        $this->assertSame('Eligibility Rules', $results[0]['section']);
        $this->assertSame('Eligibility Rules', $results[0]['targetText']);
        $this->assertSame('section', $results[0]['targetKind']);
        $this->assertSame([
            'Waiver applies after ninety days. Contact support for forms.',
            'Bring identification before submitting claims.',
        ], $results[0]['lines']);
    }

    public function test_search_falls_back_to_category_matches_in_position_order_and_applies_limit(): void
    {
        $first = HandbookCategory::query()->create([
            'category' => 'Premium Waiver',
            'position' => 0,
            'content' => '<p>General forms only.</p>',
            'is_deleted' => false,
        ]);

        HandbookCategory::query()->create([
            'category' => 'Starter Waiver',
            'position' => 1,
            'content' => '<p>General forms only.</p>',
            'is_deleted' => false,
        ]);

        $results = app(HandbookSearchService::class)->search('waiver', 1);

        $this->assertCount(1, $results);
        $this->assertSame($first->id, $results[0]['categoryId']);
        $this->assertSame('Premium Waiver', $results[0]['category']);
        $this->assertSame('', $results[0]['h2']);
        $this->assertSame('', $results[0]['section']);
        $this->assertSame([], $results[0]['lines']);
        $this->assertSame('Premium Waiver', $results[0]['targetText']);
        $this->assertSame('category', $results[0]['targetKind']);
    }
}
