import {
  Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlineX } from "solid-icons/tb";

import {
  PageShell,
  PageHeader,
  PageBody,
  Alert,
  BlockingOverlay,
  ConfirmModal,
  LoadingState,
  createConfirm,
} from "../../../components/ui";
import {
  authService,
  getCaptchaAwareErrorMessage,
} from "../../../services/authService";
import {
  getHandbookEntries,
  saveHandbookEntries,
} from "../../../services/handbookContentService";
import {
  deleteHandbookFileByPath,
  uploadHandbookFile,
} from "../../../services/handbookFilesService";
import { teamService } from "../../../services/teamService";
import {
  adminActionButtonClass,
  adminOptionForPath,
  manageHandbookActionOptions,
} from "../adminOptions";
import { HandbookEditModal } from "./modals/HandbookEditModal";
import { HandbookEditPickerModal } from "./modals/HandbookEditPickerModal";
import { HandbookReorderModal } from "./modals/HandbookReorderModal";
import type { HandbookEntry } from "./handbookTypes";

const ManageHandbook: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const [entries, setEntries] = createSignal<HandbookEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [imageUploadError, setImageUploadError] = createSignal("");
  const [accessError, setAccessError] = createSignal("");
  const [currentUserName, setCurrentUserName] = createSignal("");
  const [alertMessage, setAlertMessage] = createSignal("");
  const [alertType, setAlertType] = createSignal<"success" | "error">("success");
  const [uploadingImage, setUploadingImage] = createSignal(false);
  const [editorUploadingCount, setEditorUploadingCount] = createSignal(0);
  const [editorUploadError, setEditorUploadError] = createSignal("");
  let editorUploadErrorTimeout: number | undefined;
  const [saveResult, setSaveResult] = createSignal<{
    title: string;
    message: string;
    success: boolean;
    mode: "add" | "edit";
  } | null>(null);
  const [reorderResult, setReorderResult] = createSignal<{
    title: string;
    message: string;
    success: boolean;
  } | null>(null);
  const [deleteResult, setDeleteResult] = createSignal<{
    title: string;
    message: string;
    success: boolean;
  } | null>(null);
  const [showDeleteCategoryConfirm, setShowDeleteCategoryConfirm] =
    createSignal(false);
  const [deleteCategoryIndex, setDeleteCategoryIndex] = createSignal<
    number | null
  >(null);
  const [deletingCategory, setDeletingCategory] = createSignal(false);

  // Add/Edit modal state
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [showEditPicker, setShowEditPicker] = createSignal(false);
  const [editOpenedFromPicker, setEditOpenedFromPicker] = createSignal(false);
  const [editIndex, setEditIndex] = createSignal<number | null>(null);
  const [editDraft, setEditDraft] = createSignal<HandbookEntry>({
    category: "",
    imageUrl: "",
    imagePath: "",
    content: "",
  });
  const [editOriginal, setEditOriginal] = createSignal<HandbookEntry>({
    category: "",
    imageUrl: "",
    imagePath: "",
    content: "",
  });

  // Order modal state
  const [showOrderModal, setShowOrderModal] = createSignal(false);
  const [orderDraft, setOrderDraft] = createSignal<HandbookEntry[]>([]);

  onMount(async () => {
    const { accessLevel, isAdmin } =
      await teamService.getCurrentUserAccessLevel();
    const access = accessLevel.toLowerCase();
    if (!isAdmin && !["admin", "editor"].includes(access)) {
      setAccessError("You do not have access to manage the handbook.");
      setLoading(false);
      return;
    }
    const user = authService.getCurrentUser();
    setCurrentUserName(user?.nickname || "");
    await loadHandbook();
  });

  const loadHandbook = async () => {
    setLoading(true);
    setError("");
    try {
      const parsed = await getHandbookEntries();
      if (Array.isArray(parsed)) {
        setEntries(parsed as HandbookEntry[]);
      } else {
        setEntries([]);
      }
    } catch (err) {
      console.error("Failed to load handbook", err);
      setError(getCaptchaAwareErrorMessage(err, "Unable to load handbook data."));
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    const empty = {
      category: "",
      imageUrl: "",
      imagePath: "",
      content: "",
    };
    setEditIndex(null);
    setEditDraft(empty);
    setEditOriginal(empty);
    setEditOpenedFromPicker(false);
    setError("");
    setImageUploadError("");
    setShowEditModal(true);
  };

  const openEditModal = (index: number) => {
    const entry = entries()[index];
    if (!entry) {
      setAlertType("error");
      setAlertMessage("Unable to open that category. Please try again.");
      return;
    }
    setEditIndex(index);
    setEditDraft({ ...entry });
    setEditOriginal({ ...entry });
    setEditOpenedFromPicker(true);
    setError("");
    setImageUploadError("");
    setShowEditModal(true);
  };

  const hasUnsavedChanges = () => {
    const draft = editDraft();
    const original = editOriginal();
    return (
      draft.category !== original.category ||
      draft.imageUrl !== original.imageUrl ||
      draft.imagePath !== original.imagePath ||
      draft.content !== original.content
    );
  };

  const [DiscardModal, confirmDiscard] = createConfirm({
    title: "Unsaved changes",
  });

  const handleCancelEdit = async () => {
    if (hasUnsavedChanges()) {
      if (!(await confirmDiscard())) {
        return;
      }
    }
    const draftPath = editDraft().imagePath;
    const originalPath = editOriginal().imagePath;
    if (draftPath && draftPath !== originalPath) {
      deleteHandbookImage(draftPath);
    }
    setShowEditModal(false);
    setEditorUploadingCount(0);
    setEditorUploadError("");
    if (editorUploadErrorTimeout) {
      window.clearTimeout(editorUploadErrorTimeout);
      editorUploadErrorTimeout = undefined;
    }
    if (editOpenedFromPicker()) {
      setShowEditPicker(true);
    }
  };

  const deleteHandbookImage = async (imagePath: string) => {
    try {
      await deleteHandbookFileByPath(imagePath);
    } catch (err) {
      console.warn("Failed to delete handbook image", err);
    }
  };

  const handleImageUpload = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";

    setImageUploadError("");
    setUploadingImage(true);
    try {
      const previousPath = editDraft().imagePath;
      const originalPath = editOriginal().imagePath;
      const result = await uploadHandbookFile(file);
      setEditDraft((prev) => ({
        ...prev,
        imageUrl: result.url,
        imagePath: result.path,
      }));
      if (previousPath && previousPath !== originalPath) {
        deleteHandbookImage(previousPath);
      }
    } catch (err: any) {
      console.error("Failed to upload handbook image", err);
      setImageUploadError(err?.message || "Unable to upload image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveImage = () => {
    const draftPath = editDraft().imagePath;
    const originalPath = editOriginal().imagePath;
    if (draftPath && draftPath !== originalPath) {
      deleteHandbookImage(draftPath);
    }
    setEditDraft((prev) => ({
      ...prev,
      imageUrl: "",
      imagePath: "",
    }));
  };

  const handleSaveEntry = async () => {
    const draft = editDraft();
    const index = editIndex();
    const nextEntry = {
      ...draft,
      category: draft.category?.trim() || "New category",
    };

    let nextEntries: HandbookEntry[];
    if (index === null) {
      // Adding new
      nextEntries = [...entries(), nextEntry];
    } else {
      // Editing existing
      nextEntries = entries().map((e, i) => (i === index ? nextEntry : e));
    }

    const success = await saveEntries(nextEntries);
    if (success) {
      setEntries(nextEntries);
      setEditOriginal({ ...nextEntry });
      setEditDraft({ ...nextEntry });
      setSaveResult({
        title: "Saved",
        message: "Handbook category updated successfully.",
        success: true,
        mode: index === null ? "add" : "edit",
      });
      return;
    }
    setSaveResult({
      title: "Save failed",
      message: "Unable to save handbook changes.",
      success: false,
      mode: index === null ? "add" : "edit",
    });
  };

  const deleteCategory = async (index: number): Promise<boolean> => {
    const nextEntries = entries().filter((_, idx) => idx !== index);
    const success = await saveEntries(nextEntries);
    if (success) {
      setEntries(nextEntries);
      setDeleteResult({
        title: "Delete successful",
        message: "Handbook category deleted successfully.",
        success: true,
      });
      return true;
    }
    setDeleteResult({
      title: "Delete failed",
      message: "Unable to delete handbook category.",
      success: false,
    });
    return false;
  };

  const handleConfirmDeleteCategory = async () => {
    const index = deleteCategoryIndex();
    if (index === null) return;
    setDeletingCategory(true);
    const success = await deleteCategory(index);
    setDeletingCategory(false);
    setShowDeleteCategoryConfirm(false);
    setDeleteCategoryIndex(null);
    if (!success) return;
    setShowEditModal(false);
    setEditorUploadingCount(0);
    setEditorUploadError("");
    if (editorUploadErrorTimeout) {
      window.clearTimeout(editorUploadErrorTimeout);
      editorUploadErrorTimeout = undefined;
    }
  };

  const saveEntries = async (nextEntries: HandbookEntry[]): Promise<boolean> => {
    setSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      const updatedBy = currentUserName();
      const payload = nextEntries.map((entry) => ({
        ...entry,
        updatedAt: now,
        updatedBy,
      }));
      await saveHandbookEntries(payload);
      return true;
    } catch (err) {
      console.error("Failed to save handbook", err);
      setError(
        getCaptchaAwareErrorMessage(err, "Unable to save handbook changes."),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openOrderModal = () => {
    setOrderDraft(entries().map((entry) => ({ ...entry })));
    setShowOrderModal(true);
  };

  const moveOrderEntry = (from: number, to: number) => {
    setOrderDraft((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const hasOrderChanges = createMemo(() => {
    const current = entries().map((entry) => JSON.stringify(entry));
    const draft = orderDraft().map((entry) => JSON.stringify(entry));
    if (current.length !== draft.length) return true;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== draft[i]) return true;
    }
    return false;
  });

  const handleSaveOrder = async () => {
    if (!hasOrderChanges()) return;
    const nextEntries = orderDraft();
    const success = await saveEntries(nextEntries);
    if (success) {
      setEntries(nextEntries);
      setShowOrderModal(false);
      setReorderResult({
        title: "Reorder saved",
        message: "Handbook category order updated successfully.",
        success: true,
      });
      return;
    }
    setReorderResult({
      title: "Reorder failed",
      message: "Unable to save handbook category order.",
      success: false,
    });
  };

  createEffect(() => {
    if (!alertMessage()) return;
    const timer = setTimeout(() => setAlertMessage(""), 5000);
    return () => clearTimeout(timer);
  });

  return (
    <PageShell>
      <Show when={alertMessage()}>
        <div class="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div class="relative w-full max-w-2xl">
            <Alert type={alertType()}>{alertMessage()}</Alert>
            <button
              type="button"
              onClick={() => setAlertMessage("")}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Dismiss"
            >
              <TbOutlineX class="h-4 w-4" />
            </button>
          </div>
        </div>
      </Show>
      <PageHeader
        variant="admin"
        onBack={() => navigate(-1)}
        icon={
          <Dynamic
            component={adminOption().icon}
            class="h-5 w-5"
          />
        }
        title={adminOption().title}
        subtitle={adminOption().description}
      />

      <PageBody><div class="space-y-4">
        <Show
          when={!accessError()}
          fallback={
            <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-700">
              {accessError()}
            </div>
          }
        >
          <Show when={error()}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">
              {error()}
            </div>
          </Show>
          <Show
            when={!loading()}
            fallback={
              <div class="py-4">
                <LoadingState label="Loading handbook..." />
              </div>
            }
          >
            <div class="w-full max-w-2xl space-y-3">
              {manageHandbookActionOptions.map((option) => (
                <button
                type="button"
                onClick={() => {
                    if (option.action === "addCategory") {
                      openAddModal();
                      return;
                    }
                    if (option.action === "editCategory") {
                      setShowEditPicker(true);
                      return;
                    }
                    if (option.action === "reorderCategories") {
                      openOrderModal();
                      return;
                    }
                  }}
                  class={`${adminActionButtonClass} ${option.class || ""}`}
                >
                  <div class="flex items-start gap-3">
                    <option.icon class="mt-0.5 h-5 w-5 text-admin-from" />
                    <div>
                      <div class="text-base font-semibold text-gray-900">
                        {option.title}
                      </div>
                      <div class="text-base text-gray-500">
                        {option.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Show>
        </Show>
      </div></PageBody>

      {/* Add/Edit Category Modal */}
      <Show when={showEditModal()}>
        <HandbookEditModal
          title={editIndex() === null ? "Add Category" : "Edit Category"}
          draft={editDraft()}
          uploadingImage={uploadingImage()}
          imageUploadError={imageUploadError()}
          editorUploadingCount={editorUploadingCount()}
          editorUploadError={editorUploadError()}
          saving={saving()}
          hasChanges={hasUnsavedChanges()}
          onClose={handleCancelEdit}
          onCategoryChange={(value) =>
            setEditDraft((prev) => ({ ...prev, category: value }))
          }
          onImageUpload={handleImageUpload}
          onRemoveImage={handleRemoveImage}
          onContentChange={(content) =>
            setEditDraft((prev) => ({ ...prev, content }))
          }
          onUploadError={(message) => {
            setAlertType("error");
            setAlertMessage(message);
            setEditorUploadError(message);
            if (editorUploadErrorTimeout) {
              window.clearTimeout(editorUploadErrorTimeout);
            }
            editorUploadErrorTimeout = window.setTimeout(() => {
              setEditorUploadError("");
              editorUploadErrorTimeout = undefined;
            }, 4000);
          }}
          onEditorUploadStatusChange={setEditorUploadingCount}
          onSave={handleSaveEntry}
        />
      </Show>

      {/* Order Modal */}
      <Show when={showOrderModal()}>
        <HandbookReorderModal
          entries={orderDraft()}
          onClose={() => setShowOrderModal(false)}
          onMove={moveOrderEntry}
          onSave={handleSaveOrder}
          saving={saving()}
          hasChanges={hasOrderChanges()}
        />
      </Show>

      {/* Edit Category Picker */}
      <Show when={showEditPicker()}>
        <HandbookEditPickerModal
          entries={entries()}
          onClose={() => setShowEditPicker(false)}
          onEdit={(index) => {
            setShowEditPicker(false);
            setEditOpenedFromPicker(true);
            queueMicrotask(() => openEditModal(index));
          }}
          onDelete={(index) => {
            setDeleteCategoryIndex(index);
            setShowDeleteCategoryConfirm(true);
          }}
        />
      </Show>

      <DiscardModal />
      <ConfirmModal
        open={showDeleteCategoryConfirm()}
        title="Delete category"
        message="Delete this category?"
        confirmLabel="Delete"
        confirmLoading={deletingCategory()}
        confirmLoadingLabel="Deleting..."
        variant="danger"
        onConfirm={handleConfirmDeleteCategory}
        onCancel={() => {
          if (deletingCategory()) return;
          setShowDeleteCategoryConfirm(false);
          setDeleteCategoryIndex(null);
        }}
      />

      <BlockingOverlay
        open={saving() || deletingCategory()}
        title={deletingCategory() ? "Deleting category..." : "Saving changes..."}
        message="Please wait while your request is being processed."
        zIndexClass="z-[90]"
      />
      <ConfirmModal
        open={!!saveResult()}
        title={saveResult()?.title || ""}
        message={saveResult()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={saveResult()?.success ? "admin" : "danger"}
        onConfirm={() => {
          const result = saveResult();
          setSaveResult(null);
          if (!result?.success) return;
          setShowEditModal(false);
          setEditorUploadingCount(0);
          setEditorUploadError("");
          if (editorUploadErrorTimeout) {
            window.clearTimeout(editorUploadErrorTimeout);
            editorUploadErrorTimeout = undefined;
          }
        }}
        onCancel={() => setSaveResult(null)}
      />
      <ConfirmModal
        open={!!reorderResult()}
        title={reorderResult()?.title || ""}
        message={reorderResult()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={reorderResult()?.success ? "admin" : "danger"}
        onConfirm={() => setReorderResult(null)}
        onCancel={() => setReorderResult(null)}
      />
      <ConfirmModal
        open={!!deleteResult()}
        title={deleteResult()?.title || ""}
        message={deleteResult()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={deleteResult()?.success ? "admin" : "danger"}
        onConfirm={() => setDeleteResult(null)}
        onCancel={() => setDeleteResult(null)}
      />
    </PageShell>
  );
};

export default ManageHandbook;
