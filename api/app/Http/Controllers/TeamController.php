<?php

namespace App\Http\Controllers;

use App\Models\Agency;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $current = $request->user();
        $includeDeletedAgencies = $request->boolean('includeDeletedAgencies');
        $access = strtolower((string) ($current?->access_level ?? ''));
        if ($access === '') {
            $access = 'standard';
        }
        $isPrivileged = in_array($access, ['admin', 'editor'], true);

        $users = User::query()
            ->with('agency:id,code,name')
            ->where('is_active', true)
            ->orderBy('agency_id')
            ->orderBy('fsc_code')
            ->get()
            ->map(static function (User $user) use ($isPrivileged): array {
                $accessLevel = strtolower((string) $user->access_level);
                if ($accessLevel === '') {
                    $accessLevel = 'standard';
                }

                $record = [
                    'id' => (string) $user->id,
                    'nickname' => $user->nickname,
                    'fullName' => $user->full_name,
                    'fscCode' => $user->fsc_code,
                    'agencyCode' => $user->agency?->code ?? '',
                    'accessLevel' => $accessLevel,
                    'birthDate' => $user->birth_date?->format('Y-m-d') ?? '',
                    'contractDate' => $user->contract_date?->format('Y-m-d') ?? '',
                ];

                if ($isPrivileged) {
                    $record['email'] = $user->email;
                }

                return $record;
            })
            ->values();

        $agencyQuery = Agency::query()
            ->orderBy('position')
            ->orderBy('name');
        if (!$includeDeletedAgencies) {
            $agencyQuery->where('is_delete', false);
        }

        $agencies = $agencyQuery
            ->get(['code', 'name', 'is_delete'])
            ->map(static fn (Agency $agency): array => [
                'code' => $agency->code,
                'name' => $agency->name,
                'isDeleted' => (bool) ($agency->is_delete ?? false),
            ])
            ->values();

        return response()->json([
            'users' => $users,
            'agencies' => $agencies,
        ]);
    }
}
