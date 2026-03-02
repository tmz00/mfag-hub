<?php

namespace Tests\Feature;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeamUserControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_create_user_with_normalized_payload(): void
    {
        $admin = $this->createUser('admin', [
            'email' => 'admin@example.test',
            'fsc_code' => '90001',
            'nickname' => 'Admin',
        ]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/team/users', [
            'email' => 'NEW.USER@Example.COM',
            'fscCode' => '54321',
            'agencyCode' => '  N07 ',
            'accessLevel' => 'editor',
            'nickname' => '  New Nick  ',
            'fullName' => ' New User ',
        ]);

        $response->assertCreated()->assertJsonStructure(['uid']);

        $created = User::query()->where('email', 'new.user@example.com')->first();
        $this->assertNotNull($created);
        $created->load('agency');

        $this->assertSame('54321', $created->fsc_code);
        $this->assertSame('editor', $created->access_level);
        $this->assertSame('New Nick', $created->nickname);
        $this->assertSame('New User', $created->full_name);
        $this->assertTrue((bool) $created->is_active);
        $this->assertSame('N07', $created->agency?->code);
        $this->assertDatabaseHas('agencies', [
            'code' => 'N07',
            'name' => 'N07',
        ]);
    }

    public function test_non_admin_cannot_create_user(): void
    {
        $editor = $this->createUser('editor');
        Sanctum::actingAs($editor);

        $response = $this->postJson('/api/team/users', [
            'email' => 'blocked@example.test',
            'fscCode' => '22334',
            'agencyCode' => 'A01',
            'accessLevel' => '',
        ]);

        $response->assertForbidden()->assertJson(['message' => 'Forbidden.']);
        $this->assertDatabaseMissing('users', [
            'email' => 'blocked@example.test',
        ]);
    }

    public function test_standard_user_can_update_self_but_cannot_change_fsc_or_access_level(): void
    {
        $user = $this->createUser('standard', [
            'email' => 'owner@example.test',
            'fsc_code' => '12345',
            'nickname' => 'Owner',
        ]);
        Sanctum::actingAs($user);

        $response = $this->putJson("/api/team/users/{$user->id}", [
            'email' => 'OWNER+NEW@Example.TEST',
            'fscCode' => '99999',
            'agencyCode' => '  NEWA ',
            'accessLevel' => 'admin',
            'nickname' => '  Updated Owner  ',
            'fullName' => ' Updated Full Name ',
            'birthDate' => '1999-12-31',
            'contractDate' => '2020-01-15',
        ]);

        $response->assertOk()->assertJson(['uid' => (string) $user->id]);

        $user->refresh()->load('agency');
        $this->assertSame('owner+new@example.test', $user->email);
        $this->assertSame('12345', $user->fsc_code);
        $this->assertSame('standard', $user->access_level);
        $this->assertSame('Updated Owner', $user->nickname);
        $this->assertSame('Updated Full Name', $user->full_name);
        $this->assertSame('NEWA', $user->agency?->code);
        $this->assertSame('1999-12-31', $user->birth_date?->format('Y-m-d'));
        $this->assertSame('2020-01-15', $user->contract_date?->format('Y-m-d'));
    }

    public function test_standard_user_cannot_update_another_user(): void
    {
        $actor = $this->createUser('standard', [
            'fsc_code' => '11111',
            'nickname' => 'Actor',
        ]);
        $target = $this->createUser('standard', [
            'email' => 'target@example.test',
            'fsc_code' => '22222',
            'nickname' => 'Target',
        ]);

        Sanctum::actingAs($actor);

        $response = $this->putJson("/api/team/users/{$target->id}", [
            'email' => 'hijack@example.test',
            'fscCode' => '33333',
            'agencyCode' => 'A77',
            'accessLevel' => '',
            'nickname' => 'Hijacked',
            'fullName' => 'Hijacked User',
        ]);

        $response->assertForbidden()->assertJson(['message' => 'Forbidden.']);
        $target->refresh();
        $this->assertSame('target@example.test', $target->email);
        $this->assertSame('Target', $target->nickname);
    }

    public function test_admin_cannot_delete_own_account(): void
    {
        $admin = $this->createUser('admin', [
            'email' => 'self-delete@example.test',
            'fsc_code' => '55555',
            'nickname' => 'SelfDelete',
        ]);
        Sanctum::actingAs($admin);

        $response = $this->deleteJson("/api/team/users/{$admin->id}");

        $response->assertStatus(422)->assertJson([
            'message' => 'Admin cannot delete own account.',
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $admin->id,
        ]);
    }

    public function test_admin_soft_deletes_user_instead_of_removing_row(): void
    {
        $admin = $this->createUser('admin', [
            'email' => 'admin-delete@example.test',
            'fsc_code' => '55556',
            'nickname' => 'AdminDelete',
        ]);
        $target = $this->createUser('standard', [
            'email' => 'delete-target@example.test',
            'fsc_code' => '55557',
            'nickname' => 'DeleteTarget',
        ]);

        Sanctum::actingAs($admin);

        $this->deleteJson("/api/team/users/{$target->id}")
            ->assertOk()
            ->assertJson(['uid' => (string) $target->id]);

        $this->assertDatabaseHas('users', [
            'id' => $target->id,
            'email' => 'delete-target@example.test',
            'is_active' => false,
        ]);
    }

    public function test_store_rejects_duplicate_active_nickname_case_insensitive(): void
    {
        $admin = $this->createUser('admin', [
            'email' => 'admin-dup@example.test',
            'fsc_code' => '77777',
            'nickname' => 'AdminDup',
        ]);
        $this->createUser('standard', [
            'email' => 'existing@example.test',
            'fsc_code' => '88888',
            'nickname' => 'Alpha',
            'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/team/users', [
            'email' => 'dupnick@example.test',
            'fscCode' => '44444',
            'agencyCode' => 'A02',
            'accessLevel' => '',
            'nickname' => ' alpha ',
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors(['nickname']);
        $this->assertDatabaseMissing('users', [
            'email' => 'dupnick@example.test',
        ]);
    }

    private function createUser(string $accessLevel = 'standard', array $overrides = []): User
    {
        static $counter = 1;
        $index = $counter++;

        $agencyId = $overrides['agency_id']
            ?? $this->createAgency(sprintf('AG%02d', $index))->id;

        return User::query()->create([
            'email' => $overrides['email'] ?? sprintf('user%02d@example.test', $index),
            'fsc_code' => $overrides['fsc_code'] ?? sprintf('%05d', $index),
            'access_level' => $overrides['access_level'] ?? $accessLevel,
            'agency_id' => $agencyId,
            'nickname' => $overrides['nickname'] ?? sprintf('User%02d', $index),
            'full_name' => $overrides['full_name'] ?? sprintf('Test User %02d', $index),
            'birth_date' => $overrides['birth_date'] ?? null,
            'contract_date' => $overrides['contract_date'] ?? null,
            'is_active' => $overrides['is_active'] ?? true,
        ]);
    }

    private function createAgency(string $code, ?string $name = null): Agency
    {
        return Agency::query()->create([
            'code' => $code,
            'name' => $name ?? $code,
            'position' => 0,
            'is_delete' => false,
        ]);
    }
}
