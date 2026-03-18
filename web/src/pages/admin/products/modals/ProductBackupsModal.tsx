import {
  Component,
  Show,
  For,
  createSignal,
  createEffect,
} from "solid-js";
import {
  TbOutlineDownload,
  TbOutlineUpload,
  TbOutlineTrash,
} from "solid-icons/tb";
import { EditModal, Button, IconButton, Spinner } from "../../../../components/ui";
import { getCaptchaAwareErrorMessage } from "../../../../services/authService";
import {
  productsService,
  type ProductCatalog,
  type ProductBackup,
} from "../../../../services/productsService";
import { formatBackupDate, formatTimestamp, formatBackupOwner } from "./types";

type Props = {
  catalog: ProductCatalog | null;
  onClose: () => void;
  onRestored: () => void;
  onAlert: (type: "success" | "error", message: string) => void;
};

const ProductBackupsModal: Component<Props> = (props) => {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [backups, setBackups] = createSignal<ProductBackup[]>([]);
  const [restoringId, setRestoringId] = createSignal("");
  const [deletingId, setDeletingId] = createSignal("");
  const [pendingRestore, setPendingRestore] = createSignal<ProductBackup | null>(null);
  const [pendingImport, setPendingImport] = createSignal<ProductCatalog | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<ProductBackup | null>(null);
  let importInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    const loadBackups = async () => {
      setLoading(true);
      setError("");
      try {
        const list = await productsService.getBackups();
        setBackups(list);
      } catch (err) {
        console.error("Failed to load product backups", err);
        setError(getCaptchaAwareErrorMessage(err, "Unable to load backups."));
      } finally {
        setLoading(false);
      }
    };
    loadBackups();
  });

  const getCatalogForExport = () => {
    const data = props.catalog;
    if (!data) return null;
    const { basePlanCategories, riderCategories, ...rest } = data;
    return rest;
  };

  const downloadJson = (filename: string, data: ProductCatalog) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ProductCatalog;
      setPendingImport(parsed);
    } catch (err) {
      console.error("Failed to parse import file", err);
      setError("Unable to read JSON file.");
    } finally {
      input.value = "";
    }
  };

  const handleRestore = async (backup: ProductBackup) => {
    setRestoringId(backup.id);
    setError("");
    try {
      await productsService.restoreFromBackup(backup);
      setPendingRestore(null);
      props.onAlert("success", "Backup restored successfully.");
      props.onRestored();
    } catch (err) {
      console.error("Failed to restore product backup", err);
      setError(getCaptchaAwareErrorMessage(err, "Unable to restore backup."));
    } finally {
      setRestoringId("");
    }
  };

  const handleConfirmImport = async () => {
    const data = pendingImport();
    if (!data) return;
    setRestoringId("import");
    setError("");
    try {
      await productsService.setProducts(data, "Manage Products Backups");
      setPendingImport(null);
      props.onAlert("success", "Import completed successfully.");
      props.onRestored();
    } catch (err) {
      console.error("Failed to import product data", err);
      setError(getCaptchaAwareErrorMessage(err, "Unable to import data."));
    } finally {
      setRestoringId("");
    }
  };

  const handleDelete = async (backup: ProductBackup) => {
    setDeletingId(backup.id);
    setError("");
    try {
      await productsService.deleteBackup(backup.id);
      setBackups((prev) => prev.filter((item) => item.id !== backup.id));
      setPendingDelete(null);
    } catch (err) {
      console.error("Failed to delete product backup", err);
      setError(getCaptchaAwareErrorMessage(err, "Unable to delete backup."));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <>
      <EditModal title="Manage Products Backups" onClose={props.onClose}>
        <div class="space-y-3">
          <p class="text-base text-gray-600">
            Backups are automatically created in the database whenever an update
            is made. You may restore from any of the 50 latest backups. Backups
            expire after 3 months, so it is best to download a separate file
            backup periodically.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const data = getCatalogForExport();
                if (data) {
                  downloadJson(
                    `products-current-${formatTimestamp()}.json`,
                    data
                  );
                }
              }}
              disabled={!props.catalog}
            >
              <TbOutlineDownload class="h-4 w-4" />
              Download current data
            </Button>
            <Button
              variant="adminOutline"
              size="sm"
              onClick={() => importInputRef?.click()}
            >
              <TbOutlineUpload class="h-4 w-4" />
              Restore from JSON file
            </Button>
            <input
              ref={(el) => (importInputRef = el)}
              type="file"
              accept="application/json"
              class="hidden"
              onChange={handleImportChange}
            />
          </div>
          <Show
            when={!loading()}
            fallback={
              <div class="flex items-center justify-center py-6">
                <Spinner class="h-8 w-8 text-primary" />
              </div>
            }
          >
            <Show
              when={!error()}
              fallback={
                <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base text-red-700">
                  {error()}
                </div>
              }
            >
              <Show
                when={backups().length > 0}
                fallback={
                  <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-600">
                    No backups available.
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={backups()}>
                    {(backup) => (
                      <div class="rounded-lg border border-gray-200 bg-white px-3 py-2 space-y-2">
                        <div class="flex items-center justify-between gap-2">
                          <div class="text-base font-semibold text-gray-900">
                            {formatBackupDate(backup.createdAt)}
                          </div>
                          <div class="flex items-center gap-2">
                            <IconButton
                              size="sm"
                              onClick={() =>
                                downloadJson(
                                  `products-backup-${formatTimestamp(backup.createdAt ?? new Date())}.json`,
                                  backup.data
                                )
                              }
                              aria-label="Download backup"
                              title="Download backup"
                            >
                              <TbOutlineDownload />
                            </IconButton>
                            <Button
                              variant="adminOutline"
                              size="sm"
                              onClick={() => setPendingRestore(backup)}
                              disabled={restoringId() === backup.id}
                            >
                              Restore
                            </Button>
                            <IconButton
                              variant="danger"
                              size="sm"
                              onClick={() => setPendingDelete(backup)}
                              disabled={deletingId() === backup.id}
                              aria-label="Delete backup"
                              title="Delete backup"
                            >
                              <TbOutlineTrash />
                            </IconButton>
                          </div>
                        </div>
                        <div class="text-sm text-gray-500">
                          Expires {formatBackupDate(backup.expiresAt)}
                        </div>
                        <div class="text-sm text-gray-500">
                          Last updated by {formatBackupOwner(backup)}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </EditModal>

      {/* Confirm Restore */}
      <Show when={pendingRestore()}>
        {(backup) => (
          <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
            <div class="w-full max-w-md rounded-xl border border-orange-200 bg-white p-6 shadow-xl">
              <h3 class="text-lg font-semibold text-gray-900">
                Confirm restore?
              </h3>
              <p class="mt-2 text-base text-gray-600">
                Restore backup from {formatBackupDate(backup().createdAt)} (last
                updated by {formatBackupOwner(backup())}).
              </p>
              <div class="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingRestore(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="admin"
                  size="sm"
                  onClick={() => handleRestore(backup())}
                  disabled={restoringId() === backup().id}
                >
                  {restoringId() === backup().id
                    ? "Restoring..."
                    : "Confirm Restore"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Confirm Import */}
      <Show when={pendingImport()}>
        {(data) => (
          <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
            <div class="w-full max-w-md rounded-xl border border-orange-200 bg-white p-6 shadow-xl">
              <h3 class="text-lg font-semibold text-gray-900">
                Confirm restore?
              </h3>
              <p class="mt-2 text-base text-gray-600">
                This will overwrite current products with{" "}
                {data().basePlans?.length || 0} base plans and{" "}
                {data().riders?.length || 0} riders.
              </p>
              <div class="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingImport(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="admin"
                  size="sm"
                  onClick={handleConfirmImport}
                  disabled={restoringId() === "import"}
                >
                  {restoringId() === "import"
                    ? "Restoring..."
                    : "Confirm Restore"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Confirm Delete */}
      <Show when={pendingDelete()}>
        {(backup) => (
          <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
            <div class="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-xl">
              <h3 class="text-lg font-semibold text-gray-900">Delete backup?</h3>
              <p class="mt-2 text-base text-gray-600">
                This will permanently delete the backup from{" "}
                {formatBackupDate(backup().createdAt)}.
              </p>
              <div class="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingDelete(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="dangerSolid"
                  size="sm"
                  onClick={() => handleDelete(backup())}
                  disabled={deletingId() === backup().id}
                >
                  {deletingId() === backup().id
                    ? "Deleting..."
                    : "Confirm Delete"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </>
  );
};

export default ProductBackupsModal;
