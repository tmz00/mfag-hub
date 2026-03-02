import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineCloudDownload,
  TbOutlineCloudUpload,
  TbOutlineHistory,
  TbOutlineRotateClockwise2,
} from "solid-icons/tb";

import {
  PageShell,
  PageHeader,
  PageBody,
  Alert,
  Button,
  LoadingState,
  Spinner,
  ConfirmModal,
} from "../../../components/ui";
import {
  backupService,
  type BackupSnapshotEntry,
} from "../../../services/backupService";
import { teamService } from "../../../services/teamService";
import { adminOptionForPath } from "../adminOptions";

const formatDateTime = (value?: Date): string => {
  if (!value) return "Not available";
  return value.toLocaleString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizeSnapshotFeature = (feature?: string): string =>
  (feature || "").trim().toLowerCase();

const formatFeatureLabel = (feature?: string): string => {
  switch (normalizeSnapshotFeature(feature)) {
    case "products":
      return "Products";
    case "sources":
      return "Sources";
    case "reports":
      return "Report Templates";
    case "team":
      return "Team";
    case "handbook":
      return "Handbook";
    default:
      return "Snapshot";
  }
};

const Backups: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);

  const [loading, setLoading] = createSignal(true);
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [accessError, setAccessError] = createSignal("");
  const [snapshotHistory, setSnapshotHistory] = createSignal<
    BackupSnapshotEntry[]
  >([]);
  const [activeSnapshotFeature, setActiveSnapshotFeature] = createSignal("");
  const [loadingSnapshots, setLoadingSnapshots] = createSignal(false);
  const [pendingSnapshotRestore, setPendingSnapshotRestore] =
    createSignal<BackupSnapshotEntry | null>(null);
  const [restoringSnapshotId, setRestoringSnapshotId] = createSignal("");
  const [exportingDatabase, setExportingDatabase] = createSignal(false);
  const [pendingDatabaseImportFile, setPendingDatabaseImportFile] =
    createSignal<File | null>(null);
  const [importingDatabase, setImportingDatabase] = createSignal(false);
  const [exportingUploadedFiles, setExportingUploadedFiles] =
    createSignal(false);
  const [pendingUploadedFilesImportFile, setPendingUploadedFilesImportFile] =
    createSignal<File | null>(null);
  const [importingUploadedFiles, setImportingUploadedFiles] =
    createSignal(false);
  const [operationResult, setOperationResult] = createSignal<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  let databaseFileInputRef: HTMLInputElement | undefined;
  let uploadedFilesInputRef: HTMLInputElement | undefined;
  const snapshotHelperText = createMemo(() =>
    isAdmin()
      ? "Choose from up to the latest 50 restore snapshots for each type: Products (including GST and Type Definitions), Sources, Report Templates, Team, and Handbook. Restoring a snapshot first saves the current state as a new snapshot, then replaces that section with the saved state and removes the snapshot you used."
      : "Choose from up to the latest 50 restore snapshots for each available type: Products (including GST and Type Definitions), Sources, and Handbook. Restoring a snapshot first saves the current state as a new snapshot, then replaces that section with the saved state and removes the snapshot you used. Team and Report Template snapshots are limited to admins.",
  );
  const snapshotTabs = createMemo(() => {
    const tabsByFeature = new Map<
      string,
      {
        feature: string;
        label: string;
        count: number;
        latestTime: number;
        firstSeen: number;
      }
    >();

    snapshotHistory().forEach((entry, index) => {
      const feature = normalizeSnapshotFeature(entry.feature);
      if (!feature) return;

      const entryTime =
        entry.createdAt instanceof Date ? entry.createdAt.getTime() : -1;
      const existing = tabsByFeature.get(feature);

      if (existing) {
        existing.count += 1;
        if (entryTime > existing.latestTime) {
          existing.latestTime = entryTime;
        }
        return;
      }

      tabsByFeature.set(feature, {
        feature,
        label: formatFeatureLabel(feature),
        count: 1,
        latestTime: entryTime,
        firstSeen: index,
      });
    });

    return Array.from(tabsByFeature.values())
      .sort((left, right) => {
        if (left.latestTime !== right.latestTime) {
          return right.latestTime - left.latestTime;
        }

        return left.firstSeen - right.firstSeen;
      })
      .map(({ feature, label, count }) => ({
        feature,
        label,
        count,
      }));
  });
  const visibleSnapshots = createMemo(() => {
    const feature = activeSnapshotFeature();
    if (!feature) return [];
    return snapshotHistory().filter(
      (entry) => normalizeSnapshotFeature(entry.feature) === feature,
    );
  });

  createEffect(() => {
    const tabs = snapshotTabs();
    const activeFeature = activeSnapshotFeature();

    if (tabs.length === 0) {
      if (activeFeature !== "") setActiveSnapshotFeature("");
      return;
    }

    if (!tabs.some((tab) => tab.feature === activeFeature)) {
      setActiveSnapshotFeature(tabs[0]!.feature);
    }
  });

  const loadSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      setSnapshotHistory(await backupService.getSnapshots());
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to load snapshots.",
      });
    } finally {
      setLoadingSnapshots(false);
    }
  };

  onMount(async () => {
    const { accessLevel, isAdmin: adminAccess } =
      await teamService.getCurrentUserAccessLevel();
    const access = accessLevel.toLowerCase();
    if (!adminAccess && access !== "admin" && access !== "editor") {
      setAccessError("Only admins and editors can access backup tools.");
      setLoading(false);
      return;
    }

    setIsAdmin(adminAccess || access === "admin");
    setLoading(false);
    await loadSnapshots();
  });

  const handleRestoreSnapshot = async (snapshotId: string) => {
    setRestoringSnapshotId(snapshotId);
    try {
      await backupService.restoreSnapshot(snapshotId);
      setOperationResult({
        type: "success",
        message: "The selected snapshot was restored successfully.",
      });
      setPendingSnapshotRestore(null);
      await loadSnapshots();
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Snapshot restore failed.",
      });
    } finally {
      setRestoringSnapshotId("");
    }
  };

  const handleExportDatabase = async () => {
    setExportingDatabase(true);
    try {
      await backupService.exportDatabaseBackup();
      setOperationResult({
        type: "success",
        message: "A database dump has been downloaded.",
      });
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Database export failed.",
      });
    } finally {
      setExportingDatabase(false);
    }
  };

  const handleDatabaseImportSelection = (
    event: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setPendingDatabaseImportFile(file);
    if (databaseFileInputRef) databaseFileInputRef.value = "";
  };

  const handleImportDatabase = async () => {
    const file = pendingDatabaseImportFile();
    if (!file) return;

    setImportingDatabase(true);
    try {
      await backupService.importDatabaseBackup(file);
      setPendingDatabaseImportFile(null);
      setOperationResult({
        type: "success",
        message:
          "The uploaded database dump was restored. If the restored data invalidated your current session, sign in again.",
      });
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Database restore failed.",
      });
    } finally {
      setImportingDatabase(false);
    }
  };

  const handleExportUploadedFiles = async () => {
    setExportingUploadedFiles(true);
    try {
      await backupService.exportUploadedFilesBackup();
      setOperationResult({
        type: "success",
        message: "An uploaded files archive has been downloaded.",
      });
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Uploaded files export failed.",
      });
    } finally {
      setExportingUploadedFiles(false);
    }
  };

  const handleUploadedFilesImportSelection = (
    event: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setPendingUploadedFilesImportFile(file);
    if (uploadedFilesInputRef) uploadedFilesInputRef.value = "";
  };

  const handleImportUploadedFiles = async () => {
    const file = pendingUploadedFilesImportFile();
    if (!file) return;

    setImportingUploadedFiles(true);
    try {
      await backupService.importUploadedFilesBackup(file);
      setPendingUploadedFilesImportFile(null);
      setOperationResult({
        type: "success",
        message: "The uploaded files archive was restored.",
      });
    } catch (error) {
      setOperationResult({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Uploaded files restore failed.",
      });
    } finally {
      setImportingUploadedFiles(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={adminOption().title}
        subtitle={adminOption().description}
        icon={<Dynamic component={adminOption().icon} class="h-5 w-5" />}
        onBack={() => navigate(-1)}
        variant="admin"
      />

      <PageBody>
        <div class="space-y-6">
          <Show when={loading()}>
            <div class="py-12">
              <LoadingState label="Loading backup tools..." />
            </div>
          </Show>

          <Show when={!loading() && accessError()}>
            <Alert type="error">{accessError()}</Alert>
          </Show>

          <Show when={!loading() && !accessError()}>
            <section class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <TbOutlineHistory class="h-5 w-5" />
                Backup & Restore
              </h2>
              <p class="mb-4 text-sm text-gray-600">
                {isAdmin()
                  ? "Export the current live database or uploaded files, or restore from a previously exported version."
                  : "Export the current uploaded files, or restore the uploaded files from a previously exported version. Database backup tools are limited to admins."}
              </p>

              <div
                class={`grid gap-4 ${isAdmin() ? "lg:grid-cols-2" : ""}`}
              >
                <Show when={isAdmin()}>
                  <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <h3 class="text-base font-semibold text-gray-900">
                      Database
                    </h3>
                    <p class="mt-2 text-sm text-gray-600">
                      Export downloads a gzipped SQL dump of the current
                      database. Import resets and replaces the live database
                      only.
                    </p>

                    <div class="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="admin"
                        onClick={() => void handleExportDatabase()}
                        disabled={exportingDatabase()}
                      >
                        <Show
                          when={!exportingDatabase()}
                          fallback={<Spinner class="h-4 w-4 text-current" />}
                        >
                          <TbOutlineCloudDownload class="h-4 w-4" />
                        </Show>
                        {exportingDatabase()
                          ? "Exporting..."
                          : "Export Database"}
                      </Button>

                      <input
                        ref={databaseFileInputRef}
                        type="file"
                        accept=".sql,.gz,.sql.gz,application/gzip,text/plain"
                        onChange={handleDatabaseImportSelection}
                        class="hidden"
                      />

                      <Button
                        variant="dangerSolid"
                        onClick={() => databaseFileInputRef?.click()}
                        disabled={importingDatabase()}
                      >
                        <TbOutlineCloudUpload class="h-4 w-4" />
                        Import Database
                      </Button>
                    </div>

                    <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Database import is destructive. It replaces the live
                      database.
                    </div>
                  </div>
                </Show>

                <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <h3 class="text-base font-semibold text-gray-900">
                    Uploaded Files
                  </h3>
                  <p class="mt-2 text-sm text-gray-600">
                    Export downloads a gzipped archive of the current uploaded
                    files (including handbook and notifications). Import
                    replaces all current uploaded files.
                  </p>

                  <div class="mt-4 flex flex-wrap gap-3">
                    <Button
                      variant="admin"
                      onClick={() => void handleExportUploadedFiles()}
                      disabled={exportingUploadedFiles()}
                    >
                      <Show
                        when={!exportingUploadedFiles()}
                        fallback={<Spinner class="h-4 w-4 text-current" />}
                      >
                        <TbOutlineCloudDownload class="h-4 w-4" />
                      </Show>
                      {exportingUploadedFiles()
                        ? "Exporting..."
                        : "Export Files"}
                    </Button>

                    <input
                      ref={uploadedFilesInputRef}
                      type="file"
                      accept=".tar,.tgz,.tar.gz,.gz,application/gzip,application/x-tar"
                      onChange={handleUploadedFilesImportSelection}
                      class="hidden"
                    />

                    <Button
                      variant="dangerSolid"
                      onClick={() => uploadedFilesInputRef?.click()}
                      disabled={importingUploadedFiles()}
                    >
                      <TbOutlineCloudUpload class="h-4 w-4" />
                      Import Files
                    </Button>
                  </div>

                  <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Uploaded files import is destructive. It replaces all
                    current uploaded files.
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <TbOutlineRotateClockwise2 class="h-5 w-5" />
                Recent Snapshots
              </h2>
              <p class="mb-4 text-sm text-gray-600">{snapshotHelperText()}</p>

              <Show
                when={!loadingSnapshots()}
                fallback={<LoadingState label="Loading snapshots..." />}
              >
                <Show
                  when={snapshotHistory().length > 0}
                  fallback={
                    <div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                      No recent snapshots yet.
                    </div>
                  }
                >
                  <div class="space-y-3">
                    <div
                      class="overflow-x-auto pb-1"
                      role="tablist"
                      aria-label="Snapshot types"
                    >
                      <div class="inline-flex min-w-full gap-2 rounded-full border border-gray-200 bg-gray-50 p-1">
                        <For each={snapshotTabs()}>
                          {(tab) => {
                            const isActive = () =>
                              activeSnapshotFeature() === tab.feature;

                            return (
                              <button
                                type="button"
                                role="tab"
                                aria-selected={isActive()}
                                class={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
                                  isActive()
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-600 hover:bg-white/70"
                                }`}
                                onClick={() => setActiveSnapshotFeature(tab.feature)}
                              >
                                <span>{tab.label}</span>
                                <span
                                  class={`rounded-full px-2 py-0.5 text-xs ${
                                    isActive()
                                      ? "bg-gray-100 text-gray-700"
                                      : "bg-white text-gray-500"
                                  }`}
                                >
                                  {tab.count}
                                </span>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>

                    <For each={visibleSnapshots()}>
                      {(entry) => (
                        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div class="min-w-0">
                              <div class="font-semibold text-gray-900">
                                {entry.summary ||
                                  `${formatFeatureLabel(entry.feature)} Snapshot`}
                              </div>
                              <div class="mt-1 space-y-1 text-sm text-gray-500">
                                <div>{formatDateTime(entry.createdAt)}</div>
                                <Show when={entry.createdBy}>
                                  <div>By: {entry.createdBy}</div>
                                </Show>
                              </div>
                            </div>

                            <div class="sm:shrink-0">
                              <Button
                                variant="adminOutline"
                                onClick={() => setPendingSnapshotRestore(entry)}
                                disabled={restoringSnapshotId() === entry.id}
                              >
                                <Show
                                  when={restoringSnapshotId() !== entry.id}
                                  fallback={
                                    <Spinner class="h-4 w-4 text-current" />
                                  }
                                >
                                  <TbOutlineRotateClockwise2 class="h-4 w-4" />
                                </Show>
                                Restore
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </section>
          </Show>
        </div>
      </PageBody>

      <Show when={pendingSnapshotRestore()}>
        {(entry) => (
          <ConfirmModal
            open
            title="Restore Snapshot?"
            message={`This will restore ${formatFeatureLabel(entry().feature)} to the snapshot from ${formatDateTime(entry().createdAt)}.${entry().summary ? ` Snapshot: ${entry().summary}.` : ""} All changes made after ${formatDateTime(entry().createdAt)} will be undone! Are you sure? The current state will be saved as a new snapshot first, and the snapshot you restore will be removed.`}
            confirmLabel="Restore"
            confirmLoading={restoringSnapshotId() === entry().id}
            confirmLoadingLabel="Restoring..."
            variant="admin"
            onConfirm={() => void handleRestoreSnapshot(entry().id)}
            onCancel={() => setPendingSnapshotRestore(null)}
          />
        )}
      </Show>

      <Show when={pendingDatabaseImportFile()}>
        {(file) => (
          <ConfirmModal
            open
            title="Import Database?"
            message={`This will restore the database from ${file().name}. The live database will be replaced.`}
            confirmLabel="Restore"
            confirmLoading={importingDatabase()}
            confirmLoadingLabel="Restoring..."
            variant="danger"
            onConfirm={() => void handleImportDatabase()}
            onCancel={() => setPendingDatabaseImportFile(null)}
          />
        )}
      </Show>

      <Show when={pendingUploadedFilesImportFile()}>
        {(file) => (
          <ConfirmModal
            open
            title="Import Uploaded Files?"
            message={`This will replace the uploaded files using ${file().name}.`}
            confirmLabel="Restore"
            confirmLoading={importingUploadedFiles()}
            confirmLoadingLabel="Restoring..."
            variant="danger"
            onConfirm={() => void handleImportUploadedFiles()}
            onCancel={() => setPendingUploadedFilesImportFile(null)}
          />
        )}
      </Show>

      <ConfirmModal
        open={!!operationResult()}
        title={operationResult()?.type === "success" ? "Success" : "Error"}
        message={operationResult()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={operationResult()?.type === "success" ? "admin" : "danger"}
        onConfirm={() => setOperationResult(null)}
        onCancel={() => setOperationResult(null)}
      />
    </PageShell>
  );
};

export default Backups;
