<?php

return [
    'disk' => env('NOTIFICATION_STORAGE_DISK', env('HANDBOOK_STORAGE_DISK', 'local')),
    'prefix' => env('NOTIFICATION_STORAGE_PREFIX', 'notifications'),
];
