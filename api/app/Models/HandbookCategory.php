<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HandbookCategory extends Model
{
    use HasFactory;

    protected $fillable = [
        'category',
        'position',
        'content',
        'image_url',
        'image_path',
        'is_deleted',
        'updated_by',
    ];

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
