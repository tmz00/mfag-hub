<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AttendanceMeeting extends Model
{
    protected $fillable = [
        'title',
        'description',
        'starts_at',
        'ends_at',
        'location',
        'check_in_token',
        'created_by_id',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_id');
    }

    public function expectedUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'attendance_meeting_users', 'meeting_id', 'user_id')
            ->withTimestamps();
    }

    public function records(): HasMany
    {
        return $this->hasMany(AttendanceRecord::class, 'meeting_id');
    }
}
