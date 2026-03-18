<?php

use App\Http\Controllers\Auth\OtpAuthController;
use App\Http\Controllers\AdminBackupController;
use App\Http\Controllers\AgencyController;
use App\Http\Controllers\ClosingsController;
use App\Http\Controllers\Handbook\HandbookContentController;
use App\Http\Controllers\Handbook\HandbookFileController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProductCatalogController;
use App\Http\Controllers\ReportsController;
use App\Http\Controllers\SourcesController;
use App\Http\Controllers\TeamController;
use App\Http\Controllers\TeamUserController;
use Illuminate\Support\Facades\Route;

Route::options('/{any}', static fn () => response()->noContent())
    ->where('any', '.*');

Route::prefix('auth')->group(function (): void {
    Route::post('/request-otp', [OtpAuthController::class, 'requestOtp']);
    Route::post('/verify-otp', [OtpAuthController::class, 'verifyOtp']);
    Route::post('/refresh', [OtpAuthController::class, 'refresh']);

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('/me', [OtpAuthController::class, 'me']);
        Route::post('/logout', [OtpAuthController::class, 'logout']);
    });
});

Route::middleware('auth:sanctum')->prefix('handbook')->group(function (): void {
    Route::get('/content', [HandbookContentController::class, 'show']);
    Route::get('/files', [HandbookFileController::class, 'index']);
    Route::get('/file/{id}', [HandbookFileController::class, 'show'])->whereNumber('id');

    Route::middleware('role:admin,editor')->group(function (): void {
        Route::put('/content', [HandbookContentController::class, 'update']);
        Route::post('/upload', [HandbookFileController::class, 'store']);
        Route::delete('/file/{id}', [HandbookFileController::class, 'destroy'])->whereNumber('id');
        Route::delete('/file', [HandbookFileController::class, 'destroyByPath']);
    });
});

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/team', [TeamController::class, 'index']);
    Route::get('/closings', [ClosingsController::class, 'index']);
    Route::get('/closings/date-range', [ClosingsController::class, 'dateRange']);
    Route::get('/closings/{id}', [ClosingsController::class, 'show'])->whereNumber('id');
    Route::post('/closings', [ClosingsController::class, 'store']);
    Route::put('/closings/{id}', [ClosingsController::class, 'update'])->whereNumber('id');
    Route::delete('/closings/{id}', [ClosingsController::class, 'destroy'])->whereNumber('id');
    Route::get('/products', [ProductCatalogController::class, 'show']);
    Route::get('/sources', [SourcesController::class, 'index']);
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::get('/notifications/{id}', [NotificationController::class, 'show'])->whereNumber('id');
    Route::get('/notifications/attachments/{fileId}', [NotificationController::class, 'downloadAttachment'])->whereNumber('fileId');
    Route::get('/notifications/push/public-key', [NotificationController::class, 'getPushPublicKey']);
    Route::post('/notifications/push-subscriptions', [NotificationController::class, 'upsertPushSubscription']);
    Route::delete('/notifications/push-subscriptions', [NotificationController::class, 'deletePushSubscription']);
    Route::get('/notifications/read-state/{userId}', [NotificationController::class, 'getLastRead'])->whereNumber('userId');
    Route::put('/notifications/read-state/{userId}', [NotificationController::class, 'markRead'])->whereNumber('userId');
    Route::get('/notifications/unread-count/{userId}', [NotificationController::class, 'unreadCount'])->whereNumber('userId');
    Route::put('/team/users/{id}', [TeamUserController::class, 'update'])->whereNumber('id');

    Route::middleware('role:admin')->group(function (): void {
        Route::get('/closings/months/{monthKey}/data', [ClosingsController::class, 'monthData'])
            ->where('monthKey', '[0-9]{6}');
        Route::put('/closings/months/{monthKey}/data', [ClosingsController::class, 'replaceMonthData'])
            ->where('monthKey', '[0-9]{6}');
        Route::get('/closings/months/{monthKey}/backups', [ClosingsController::class, 'monthBackups'])
            ->where('monthKey', '[0-9]{6}');
        Route::delete('/closings/backups/{id}', [ClosingsController::class, 'deleteBackup'])->whereNumber('id');
        Route::get('/reports', [ReportsController::class, 'show']);
        Route::put('/reports', [ReportsController::class, 'update']);
        Route::get('/reports/logo', [ReportsController::class, 'showLogo']);
        Route::post('/reports/logo', [ReportsController::class, 'uploadLogo']);
        Route::delete('/reports/logo', [ReportsController::class, 'deleteLogo']);
        Route::post('/reports/render-pdf', [ReportsController::class, 'renderPdf']);
        Route::get('/reports/backups', [ReportsController::class, 'backups']);
        Route::delete('/reports/backups/{id}', [ReportsController::class, 'deleteBackup'])->whereNumber('id');
        Route::post('/team/users', [TeamUserController::class, 'store']);
        Route::put('/team/users/bulk-agency', [TeamUserController::class, 'bulkUpdateAgency']);
        Route::delete('/team/users/{id}', [TeamUserController::class, 'destroy'])->whereNumber('id');
        Route::put('/agencies', [AgencyController::class, 'upsertMany']);
        Route::delete('/agencies/{code}', [AgencyController::class, 'destroy']);
        Route::post('/backups/database/export', [AdminBackupController::class, 'exportDatabaseBackup']);
        Route::post('/backups/database/import', [AdminBackupController::class, 'importDatabaseBackup']);
        Route::get('/notifications/admin', [NotificationController::class, 'adminIndex']);
        Route::post('/notifications', [NotificationController::class, 'store']);
        Route::put('/notifications/{id}', [NotificationController::class, 'update'])->whereNumber('id');
        Route::post('/notifications/{id}/send', [NotificationController::class, 'send'])->whereNumber('id');
        Route::post('/notifications/{id}/attachments', [NotificationController::class, 'uploadAttachment'])->whereNumber('id');
        Route::delete('/notifications/{id}/attachments/{fileId}', [NotificationController::class, 'deleteAttachment'])->whereNumber(['id', 'fileId']);
        Route::delete('/notifications/{id}', [NotificationController::class, 'destroy'])->whereNumber('id');
    });

    Route::middleware('role:admin,editor')->group(function (): void {
        Route::put('/products', [ProductCatalogController::class, 'update']);
        Route::put('/sources', [SourcesController::class, 'replace']);
        Route::post('/backups/files/export', [AdminBackupController::class, 'exportUploadedFilesBackup']);
        Route::post('/backups/files/import', [AdminBackupController::class, 'importUploadedFilesBackup']);
        Route::get('/backups/snapshots', [AdminBackupController::class, 'snapshots']);
        Route::post('/backups/snapshots/{snapshotId}/restore', [AdminBackupController::class, 'restoreSnapshot']);
    });
});
