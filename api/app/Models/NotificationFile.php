<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotificationFile extends Model
{
    use HasFactory;

    protected $fillable = [
        'notification_id',
        'storage_path',
        'mime_type',
        'size_bytes',
        'uploaded_by_id',
    ];

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by_id');
    }
}
