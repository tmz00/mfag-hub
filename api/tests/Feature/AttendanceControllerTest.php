<?php

namespace Tests\Feature;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttendanceControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_admin_can_create_selected_meeting_and_view_absent_expected_attendees(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-09 09:00:00'));
        $admin = $this->createUser('admin', [
            'email' => 'attendance-admin@example.test',
            'fsc_code' => '90001',
        ]);
        $expected = $this->createUser('standard', [
            'email' => 'expected@example.test',
            'fsc_code' => '10001',
            'nickname' => 'Expected FSC',
        ]);
        $notExpected = $this->createUser('standard', [
            'email' => 'not-expected@example.test',
            'fsc_code' => '10002',
            'nickname' => 'Not Expected FSC',
        ]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/attendance/admin/meetings', [
            'title' => '  Weekly Meeting  ',
            'description' => '  Training agenda  ',
            'startsAt' => '2026-06-09T10:00:00+08:00',
            'endsAt' => '2026-06-09T11:00:00+08:00',
            'location' => '  HQ Room 1  ',
            'attendeeMode' => 'selected',
            'attendeeUserIds' => [$expected->id],
        ]);

        $response->assertCreated()
            ->assertJsonPath('meeting.title', 'Weekly Meeting')
            ->assertJsonPath('meeting.location', 'HQ Room 1');

        $meetingId = (int) $response->json('meeting.id');
        $this->assertDatabaseHas('attendance_meetings', [
            'id' => $meetingId,
            'title' => 'Weekly Meeting',
            'description' => 'Training agenda',
            'created_by_id' => $admin->id,
        ]);
        $this->assertDatabaseHas('attendance_meeting_users', [
            'meeting_id' => $meetingId,
            'user_id' => $expected->id,
        ]);
        $this->assertDatabaseMissing('attendance_meeting_users', [
            'meeting_id' => $meetingId,
            'user_id' => $notExpected->id,
        ]);

        $showResponse = $this->getJson("/api/attendance/admin/meetings/{$meetingId}");
        $showResponse->assertOk()
            ->assertJsonCount(1, 'attendance')
            ->assertJsonPath('attendance.0.userId', (string) $expected->id)
            ->assertJsonPath('attendance.0.status', 'absent');
    }

    public function test_check_in_records_attendance_once_and_marks_late_after_grace_period(): void
    {
        $admin = $this->createUser('admin', ['fsc_code' => '91001']);
        $fsc = $this->createUser('standard', [
            'email' => 'checkin@example.test',
            'fsc_code' => '11001',
        ]);
        Sanctum::actingAs($admin);
        $meetingId = (int) $this->postJson('/api/attendance/admin/meetings', [
            'title' => 'Late Check-in Test',
            'startsAt' => '2026-06-09T10:00:00Z',
            'endsAt' => '2026-06-09T12:00:00Z',
            'attendeeMode' => 'all',
        ])->assertCreated()->json('meeting.id');

        $token = (string) DB::table('attendance_meetings')
            ->where('id', $meetingId)
            ->value('check_in_token');

        Carbon::setTestNow(Carbon::parse('2026-06-09T10:20:00Z'));
        Sanctum::actingAs($fsc);

        $first = $this->postJson('/api/attendance/check-in', ['token' => $token]);
        $first->assertOk()
            ->assertJsonPath('meeting.id', (string) $meetingId)
            ->assertJsonPath('record.status', 'late')
            ->assertJsonPath('duplicate', false);

        $second = $this->postJson('/api/attendance/check-in', ['token' => $token]);
        $second->assertOk()
            ->assertJsonPath('duplicate', true)
            ->assertJsonPath('record.status', 'late');

        $this->assertSame(1, DB::table('attendance_records')->where([
            'meeting_id' => $meetingId,
            'user_id' => $fsc->id,
        ])->count());

        $history = $this->getJson('/api/attendance/history');
        $history->assertOk()
            ->assertJsonCount(1, 'records')
            ->assertJsonPath('records.0.meeting.title', 'Late Check-in Test')
            ->assertJsonPath('records.0.status', 'late');
    }

    public function test_selected_meeting_rejects_unexpected_attendee(): void
    {
        $admin = $this->createUser('admin', ['fsc_code' => '92001']);
        $expected = $this->createUser('standard', ['fsc_code' => '12001']);
        $unexpected = $this->createUser('standard', ['fsc_code' => '12002']);
        Sanctum::actingAs($admin);

        $meetingId = (int) $this->postJson('/api/attendance/admin/meetings', [
            'title' => 'Selected Users',
            'startsAt' => '2026-06-09T10:00:00+08:00',
            'attendeeMode' => 'selected',
            'attendeeUserIds' => [$expected->id],
        ])->assertCreated()->json('meeting.id');
        $token = (string) DB::table('attendance_meetings')
            ->where('id', $meetingId)
            ->value('check_in_token');

        Sanctum::actingAs($unexpected);
        $this->postJson('/api/attendance/check-in', ['token' => $token])
            ->assertForbidden()
            ->assertJson(['message' => 'You are not in the expected attendee list for this meeting.']);

        $this->assertDatabaseMissing('attendance_records', [
            'meeting_id' => $meetingId,
            'user_id' => $unexpected->id,
        ]);
    }

    public function test_standard_user_cannot_create_attendance_meeting(): void
    {
        $standard = $this->createUser('standard', [
            'email' => 'blocked-attendance@example.test',
            'fsc_code' => '93002',
        ]);
        Sanctum::actingAs($standard);

        $this->postJson('/api/attendance/admin/meetings', [
            'title' => 'Blocked Meeting',
            'startsAt' => '2026-06-09T10:00:00+08:00',
            'attendeeMode' => 'all',
        ])->assertForbidden();
    }

    public function test_admin_can_manually_mark_attendance(): void
    {
        $admin = $this->createUser('admin', ['fsc_code' => '94001']);
        $fsc = $this->createUser('standard', [
            'email' => 'manual@example.test',
            'fsc_code' => '14001',
        ]);
        Sanctum::actingAs($admin);
        $meetingId = (int) $this->postJson('/api/attendance/admin/meetings', [
            'title' => 'Manual Mark',
            'startsAt' => '2026-06-09T10:00:00+08:00',
            'attendeeMode' => 'selected',
            'attendeeUserIds' => [$fsc->id],
        ])->assertCreated()->json('meeting.id');

        $this->putJson("/api/attendance/admin/meetings/{$meetingId}/mark", [
            'userId' => $fsc->id,
            'status' => 'excused',
            'note' => 'Client appointment',
        ])->assertOk()
            ->assertJsonPath('record.status', 'excused');

        $this->assertDatabaseHas('attendance_records', [
            'meeting_id' => $meetingId,
            'user_id' => $fsc->id,
            'status' => 'excused',
            'marked_by_id' => $admin->id,
            'note' => 'Client appointment',
        ]);

        $this->getJson("/api/attendance/admin/meetings/{$meetingId}")
            ->assertOk()
            ->assertJsonPath('attendance.0.status', 'excused')
            ->assertJsonPath('attendance.0.markedBy', $admin->full_name);
    }

    private function createUser(string $accessLevel = 'standard', array $overrides = []): User
    {
        static $counter = 1;
        $index = $counter++;

        $agencyId = $overrides['agency_id']
            ?? $this->createAgency(sprintf('AT%02d', $index))->id;

        return User::query()->create([
            'email' => $overrides['email'] ?? sprintf('attendance-user%02d@example.test', $index),
            'fsc_code' => $overrides['fsc_code'] ?? sprintf('%05d', $index),
            'access_level' => $overrides['access_level'] ?? $accessLevel,
            'agency_id' => $agencyId,
            'nickname' => $overrides['nickname'] ?? sprintf('AttendanceUser%02d', $index),
            'full_name' => $overrides['full_name'] ?? sprintf('Attendance User %02d', $index),
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
