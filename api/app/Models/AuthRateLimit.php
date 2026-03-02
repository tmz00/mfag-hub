<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AuthRateLimit extends Model
{
    use HasFactory;

    protected $fillable = [
        'bucket_key',
        'email',
        'ip_address',
        'action',
        'window_started_at',
        'expires_at',
        'count',
    ];

    protected function casts(): array
    {
        return [
            'window_started_at' => 'datetime',
            'expires_at' => 'datetime',
            'count' => 'integer',
        ];
    }
}
