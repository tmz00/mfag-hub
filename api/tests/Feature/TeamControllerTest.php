<?php

namespace Tests\Feature;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeamControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_team_endpoint_excludes_inactive_users(): void
    {
        $agency = Agency::query()->create([
            'code' => 'A01',
            'name' => 'Agency One',
            'position' => 0,
            'is_delete' => false,
        ]);
        Agency::query()->create([
            'code' => 'A99',
            'name' => 'Legacy Agency',
            'position' => 1,
            'is_delete' => true,
        ]);

        $viewer = User::query()->create([
            'email' => 'viewer@example.test',
            'fsc_code' => '90001',
            'access_level' => 'admin',
            'agency_id' => $agency->id,
            'nickname' => 'Viewer',
            'full_name' => 'Viewer User',
            'is_active' => true,
        ]);

        $activeMember = User::query()->create([
            'email' => 'active@example.test',
            'fsc_code' => '12345',
            'access_level' => 'standard',
            'agency_id' => $agency->id,
            'nickname' => 'Active',
            'full_name' => 'Active User',
            'is_active' => true,
        ]);

        $inactiveMember = User::query()->create([
            'email' => 'inactive@example.test',
            'fsc_code' => '54321',
            'access_level' => 'standard',
            'agency_id' => $agency->id,
            'nickname' => 'Inactive',
            'full_name' => 'Inactive User',
            'is_active' => false,
        ]);

        Sanctum::actingAs($viewer);

        $response = $this->getJson('/api/team');
        $response->assertOk();

        $users = $response->json('users');
        $this->assertIsArray($users);

        $userIds = collect($users)->pluck('id')->all();
        $this->assertContains((string) $activeMember->id, $userIds);
        $this->assertContains((string) $viewer->id, $userIds);
        $this->assertNotContains((string) $inactiveMember->id, $userIds);

        $agencies = $response->json('agencies');
        $this->assertSame([[
            'code' => 'A01',
            'name' => 'Agency One',
            'isDeleted' => false,
        ]], $agencies);
    }

    public function test_team_endpoint_can_include_soft_deleted_agencies_for_legacy_reporting(): void
    {
        $agency = Agency::query()->create([
            'code' => 'A01',
            'name' => 'Agency One',
            'position' => 0,
            'is_delete' => false,
        ]);
        Agency::query()->create([
            'code' => 'A99',
            'name' => 'Legacy Agency',
            'position' => 1,
            'is_delete' => true,
        ]);

        $viewer = User::query()->create([
            'email' => 'viewer@example.test',
            'fsc_code' => '90001',
            'access_level' => 'admin',
            'agency_id' => $agency->id,
            'nickname' => 'Viewer',
            'full_name' => 'Viewer User',
            'is_active' => true,
        ]);

        Sanctum::actingAs($viewer);

        $response = $this->getJson('/api/team?includeDeletedAgencies=1');
        $response->assertOk();

        $agencies = collect($response->json('agencies'));
        $agencyCodes = $agencies->pluck('code')->all();
        $this->assertSame(['A01', 'A99'], $agencyCodes);
        $legacyAgency = $agencies->firstWhere('code', 'A99');
        $this->assertTrue((bool) ($legacyAgency['isDeleted'] ?? false));
    }
}
