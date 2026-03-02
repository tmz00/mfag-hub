<?php

namespace Tests\Feature;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AgencyControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_soft_deletes_agency_without_breaking_linked_users(): void
    {
        $targetAgency = $this->createAgency('KEEP', 'Keep Agency');
        $adminAgency = $this->createAgency('ADM', 'Admin Agency');
        $admin = $this->createUser('admin', $adminAgency->id, '90001');
        $member = $this->createUser('standard', $targetAgency->id, '90002');

        Sanctum::actingAs($admin);

        $this->deleteJson('/api/agencies/KEEP')
            ->assertOk()
            ->assertJson(['deleted' => true]);

        $this->assertDatabaseHas('agencies', [
            'id' => $targetAgency->id,
            'code' => 'KEEP',
            'is_delete' => true,
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $member->id,
            'agency_id' => $targetAgency->id,
            'is_active' => true,
        ]);
        $this->assertDatabaseHas('admin_restore_snapshots', [
            'feature' => 'team',
            'summary' => 'after deleting agency Keep Agency (KEEP)',
        ]);
    }

    private function createAgency(string $code, string $name): Agency
    {
        return Agency::query()->create([
            'code' => $code,
            'name' => $name,
            'position' => 0,
            'is_delete' => false,
        ]);
    }

    private function createUser(string $accessLevel, int $agencyId, string $fscCode): User
    {
        static $counter = 1;
        $index = $counter++;

        return User::query()->create([
            'email' => sprintf('agency-user%02d@example.test', $index),
            'fsc_code' => $fscCode,
            'access_level' => $accessLevel,
            'agency_id' => $agencyId,
            'nickname' => sprintf('AgencyUser%02d', $index),
            'full_name' => sprintf('Agency Test User %02d', $index),
            'is_active' => true,
        ]);
    }
}
