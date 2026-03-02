import {
  Component,
  createSignal,
  createResource,
  createEffect,
  createMemo,
  For,
  Index,
  Show,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineArrowDown,
  TbOutlineArrowUp,
  TbOutlinePencil,
  TbOutlineTrash,
} from "solid-icons/tb";
import { PageShell, PageHeader, PageBody, Button, ConfirmModal, EditModal, IconButton, ReorderList } from "../../../components/ui";
import {
  sourcesService,
  type Source,
  type SourceChild,
} from "../../../services/sourcesService";
import {
  adminActionButtonClass,
  adminOptionForPath,
  manageSourcesActionOptions,
} from "../adminOptions";

const ManageSources: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const [sources, { refetch }] = createResource(() => sourcesService.getSources());
  const [localSources, setLocalSources] = createSignal<Source[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");
  const [resultDialog, setResultDialog] = createSignal<{
    title: string;
    message: string;
    variant: "admin" | "danger";
  } | null>(null);
  const [hasChanges, setHasChanges] = createSignal(false);

  // Form state
  const [showForm, setShowForm] = createSignal(false);
  const [editingSource, setEditingSource] = createSignal<Source | null>(null);
  const [returnToEditPickerOnClose, setReturnToEditPickerOnClose] =
    createSignal(false);
  const [formLabel, setFormLabel] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
  const [formChildren, setFormChildren] = createSignal<SourceChild[]>([]);

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = createSignal(false);
  const [deletingSource, setDeletingSource] = createSignal<Source | null>(null);

  // Reorder modal state
  const [showReorderModal, setShowReorderModal] = createSignal(false);
  const [reorderList, setReorderList] = createSignal<Source[]>([]);
  const [reorderDirty, setReorderDirty] = createSignal(false);
  const [showEditPicker, setShowEditPicker] = createSignal(false);

  // Sync remote sources to local state
  createEffect(() => {
    const remoteSources = sources();
    if (remoteSources && !hasChanges()) {
      setLocalSources(JSON.parse(JSON.stringify(remoteSources)));
    }
  });

  createEffect(() => {
    const message = error();
    if (!message) return;
    setResultDialog({
      title: "Error",
      message,
      variant: "danger",
    });
    setError("");
  });

  createEffect(() => {
    const message = success();
    if (!message) return;
    setResultDialog({
      title: "Success",
      message,
      variant: "admin",
    });
    setSuccess("");
  });

  // Form handlers
  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error) {
      const message = error.message.trim();
      if (message) return message;
    }

    if (typeof error === "string") {
      const message = error.trim();
      if (message) return message;
    }

    if (error && typeof error === "object" && "message" in error) {
      const message = String((error as { message?: unknown }).message || "").trim();
      if (message) return message;
    }

    return fallback;
  };

  const normalizeSourceId = (value: string) => {
    const parts = value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    if (!parts.length) return "";
    return parts[0] + parts.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  };

  const ensureUniqueId = (baseId: string, usedIds: Set<string>) => {
    if (!baseId) return baseId;
    if (!usedIds.has(baseId)) return baseId;
    let counter = 2;
    let nextId = `${baseId}${counter}`;
    while (usedIds.has(nextId)) {
      counter += 1;
      nextId = `${baseId}${counter}`;
    }
    return nextId;
  };

  const openAddSource = () => {
    setReturnToEditPickerOnClose(false);
    setEditingSource(null);
    setFormLabel("");
    setFormDescription("");
    setFormChildren([]);
    setShowForm(true);
  };

  const openEditSource = (source: Source, reopenPickerOnClose = false) => {
    setReturnToEditPickerOnClose(reopenPickerOnClose);
    setEditingSource(source);
    setFormLabel(source.label);
    setFormDescription(source.description || "");
    setFormChildren(JSON.parse(JSON.stringify(source.children)));
    setShowForm(true);
  };

  const closeForm = (reopenPicker = false) => {
    setShowForm(false);
    setShowEditPicker(reopenPicker);
    setReturnToEditPickerOnClose(false);
    setEditingSource(null);
    setFormLabel("");
    setFormDescription("");
    setFormChildren([]);
  };

  const formHasMeaningfulChanges = createMemo(() => {
    const current = editingSource();
    const trimmedLabel = formLabel().trim();
    const trimmedDescription = formDescription().trim();
    const normalizedChildren = formChildren()
      .filter((child) => child.label.trim())
      .map((child) => ({
        id: child.id,
        label: child.label.trim(),
      }));

  if (!current) {
    return (
      trimmedLabel !== "" ||
      trimmedDescription !== "" ||
      normalizedChildren.length > 0
    );
  }

    if (trimmedLabel !== current.label.trim()) {
      return true;
    }
    if (trimmedDescription !== (current.description || "").trim()) {
      return true;
    }

    const currentChildren = current.children
      .filter((child) => child.label.trim())
      .map((child) => ({
        id: child.id,
        label: child.label.trim(),
      }));

    if (normalizedChildren.length !== currentChildren.length) {
      return true;
    }

    return normalizedChildren.some((child, index) => {
      const existingChild = currentChildren[index];
      return (
        child.id !== existingChild?.id || child.label !== existingChild?.label
      );
    });
  });

  const handleSaveSource = async () => {
    const label = formLabel().trim();
    if (!label) {
      setError("Source name is required");
      return;
    }

    const current = editingSource();
    const existingIds = new Set(localSources().map((source) => source.id));
    if (current?.id) {
      existingIds.delete(current.id);
    }
    const baseId = normalizeSourceId(label);
    const resolvedId = current?.id || ensureUniqueId(baseId, existingIds);
    const childIds = new Set<string>();
    const nextChildren = formChildren()
      .filter((c) => c.label.trim())
      .map((child) => {
        const baseChildId = normalizeSourceId(child.label);
        const resolvedChildId = current
          ? child.id
          : ensureUniqueId(baseChildId, childIds);
        childIds.add(resolvedChildId);
        return {
          ...child,
          id: resolvedChildId,
        };
      });

    const newSource: Source = {
      id: resolvedId,
      label,
      description: formDescription().trim(),
      children: nextChildren,
    };

    setSaving(true);
    setError("");
    try {
      let updated: Source[];
      if (current) {
        updated = localSources().map((s) => (s.id === current.id ? newSource : s));
      } else {
        updated = [...localSources(), newSource];
      }
      await sourcesService.saveSources(updated);
      setLocalSources(updated);
      setSuccess(`Source ${current ? "updated" : "created"} successfully`);
      closeForm(false);
      refetch();
    } catch (e) {
      console.error("Failed to save source", e);
      setError(getErrorMessage(e, "Failed to save. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const handleAddChild = () => {
    setFormChildren((prev) => [...prev, { id: "", label: "" }]);
  };

  const handleUpdateChildLabel = (index: number, label: string) => {
    setFormChildren((prev) =>
      prev.map((c, i) => (i === index ? { ...c, label } : c))
    );
  };

  const handleDeleteChild = (index: number) => {
    setFormChildren((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveChild = (from: number, to: number) => {
    setFormChildren((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  // Delete handlers
  const openDeleteSource = (source: Source) => {
    setDeletingSource(source);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDeletingSource(null);
  };

  const handleConfirmDelete = async () => {
    const source = deletingSource();
    if (!source) return;

    setSaving(true);
    setError("");
    try {
      const updated = localSources().filter((s) => s.id !== source.id);
      await sourcesService.saveSources(updated);
      setLocalSources(updated);
      setSuccess(`Source "${source.label}" deleted successfully`);
      closeDeleteModal();
      refetch();
    } catch (e) {
      console.error("Failed to delete source", e);
      setError(getErrorMessage(e, "Failed to delete. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  // Reorder handlers
  const openReorderModal = () => {
    setReorderList(JSON.parse(JSON.stringify(localSources())));
    setReorderDirty(false);
    setShowReorderModal(true);
  };

  const closeReorderModal = () => {
    setShowReorderModal(false);
    setReorderList([]);
    setReorderDirty(false);
  };

  const handleMoveSource = (from: number, to: number) => {
    const newList = [...reorderList()];
    const [item] = newList.splice(from, 1);
    newList.splice(to, 0, item);
    setReorderList(newList);
    setReorderDirty(true);
  };

  const handleSaveReorder = async () => {
    setSaving(true);
    setError("");
    try {
      await sourcesService.saveSources(reorderList());
      setLocalSources(reorderList());
      setShowReorderModal(false);
      setReorderDirty(false);
      setSuccess("Source order updated successfully");
      refetch();
    } catch (e) {
      console.error("Failed to reorder sources", e);
      setError(getErrorMessage(e, "Failed to save order. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        title={adminOption().title}
        subtitle={adminOption().description}
        icon={
          <Dynamic
            component={adminOption().icon}
            class="h-5 w-5"
          />
        }
        onBack={() => navigate(-1)}
      />

      <PageBody><div class="space-y-4">
        <div class="w-full max-w-2xl space-y-3">
          <For each={manageSourcesActionOptions}>
            {(option) => (
              <button
                type="button"
                onClick={() => {
                  if (option.action === "addSource") {
                    openAddSource();
                    return;
                  }
                  if (option.action === "editSource") {
                    setShowEditPicker(true);
                    return;
                  }
                  openReorderModal();
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
            )}
          </For>
        </div>
      </div></PageBody>

      {/* Add/Edit Form Modal */}
      <Show when={showForm()}>
        <EditModal
          title={editingSource() ? "Edit Source" : "Add Source"}
          onClose={() => closeForm(returnToEditPickerOnClose())}
          onSave={handleSaveSource}
          saving={() => saving()}
          saveDisabled={
            saving() ||
            !formLabel().trim() ||
            (editingSource() !== null && !formHasMeaningfulChanges())
          }
        >
          <div class="space-y-4">
            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Source category name
              </label>
              <input
                type="text"
                value={formLabel()}
                onInput={(e) => setFormLabel(e.currentTarget.value)}
                placeholder="e.g. Roadshow"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
              />
            </div>
            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Description (optional)
              </label>
              <input
                type="text"
                value={formDescription()}
                onInput={(e) => setFormDescription(e.currentTarget.value)}
                placeholder="Short helper text shown in the picker"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
              />
            </div>

            <div>
              <div class="mb-2">
                <label class="text-base font-medium text-gray-700">
                  Items (optional)
                </label>
              </div>
              <div>
                <Index each={formChildren()}>
                  {(child, index) => (
                    <div
                      class={`flex items-center gap-2 px-2 py-2 ${
                        index % 2 === 0 ? "bg-admin-from/5" : "bg-admin-from/10"
                      }`}
                    >
                      <div class="flex-1">
                        <input
                          type="text"
                          value={child().label}
                          onInput={(e) =>
                            handleUpdateChildLabel(index, e.currentTarget.value)
                          }
                          placeholder="e.g. Absolute Fest"
                          class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                        />
                      </div>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveChild(index, index - 1)}
                        disabled={index === 0}
                        class="h-6 w-6 rounded-lg text-gray-600"
                        aria-label="Move item up"
                      >
                        <TbOutlineArrowUp class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveChild(index, index + 1)}
                        disabled={index === formChildren().length - 1}
                        class="h-6 w-6 rounded-lg text-gray-600"
                        aria-label="Move item down"
                      >
                        <TbOutlineArrowDown class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => handleDeleteChild(index)}
                        class="h-6 w-6 rounded-lg text-red-600 hover:bg-red-50"
                        aria-label="Delete item"
                      >
                        <TbOutlineTrash class="h-4 w-4" />
                      </IconButton>
                    </div>
                  )}
                </Index>
              </div>
              <div class="mt-3 flex justify-center">
                <Button
                  type="button"
                  variant="adminOutline"
                  size="sm"
                  onClick={handleAddChild}
                >
                  + Add item
                </Button>
              </div>
            </div>
          </div>
        </EditModal>
      </Show>

      {/* Edit Picker Modal */}
      <Show when={showEditPicker()}>
        <EditModal
          title="Choose a source to edit"
          onClose={() => setShowEditPicker(false)}
          bodyClass="pb-6 pt-4"
        >
          <Show
            when={localSources().length > 0}
            fallback={<div class="text-base text-gray-600">No sources available.</div>}
          >
            <div class="space-y-2">
              <For each={localSources()}>
                {(source) => (
                  <div
                    class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 transition hover:border-admin-from/40 hover:bg-admin-from/5"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="font-semibold text-gray-900">{source.label}</div>
                      <Show when={source.description}>
                        <div class="text-sm text-gray-500">{source.description}</div>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2">
                      <IconButton
                        type="button"
                        variant="adminOutline"
                        onClick={() => {
                          setShowEditPicker(false);
                          openEditSource(source, true);
                        }}
                        aria-label="Edit"
                      >
                        <TbOutlinePencil class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="default"
                        onClick={() => openDeleteSource(source)}
                        disabled={saving()}
                        class="border border-gray-300 text-red-600 hover:bg-red-50"
                        aria-label="Delete"
                      >
                        <TbOutlineTrash class="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </EditModal>
      </Show>

      <ConfirmModal
        open={showDeleteModal()}
        title="Delete Source?"
        message={`This will permanently delete "${deletingSource()?.label || ""}"${
          deletingSource()?.children.length
            ? ` and its ${deletingSource()?.children.length} item(s)`
            : ""
        }.`}
        confirmLabel="Delete"
        variant="danger"
        confirmLoading={saving()}
        confirmLoadingLabel="Deleting..."
        disableCancelWhileLoading
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={closeDeleteModal}
      />

      {/* Reorder Modal */}
      <Show when={showReorderModal()}>
        <EditModal
          title="Reorder Sources"
          onClose={closeReorderModal}
          onSave={handleSaveReorder}
          saving={() => saving()}
          saveDisabled={saving() || !reorderDirty()}
          hasUnsavedChanges={() => reorderDirty()}
        >
          <div class="pb-4 text-base text-gray-600">
            Change the order of closing sources by moving items up or down.<br />
            <br />
            This affects how sources are displayed in the closing submission form.
          </div>
          <ReorderList
            items={reorderList()}
            itemKey={(source) => source.id}
            onMove={handleMoveSource}
            emptyMessage="No sources available."
            renderLabel={(source) => (
              <div class="min-w-0">
                <div class="text-base font-medium text-gray-800">
                  {source.label}
                </div>
                <Show when={source.children.length > 0}>
                  <div class="text-sm text-gray-500">
                    {source.children.length} item{source.children.length !== 1 ? "s" : ""}
                  </div>
                </Show>
              </div>
            )}
          />
        </EditModal>
      </Show>

      <ConfirmModal
        open={!!resultDialog()}
        title={resultDialog()?.title || ""}
        message={resultDialog()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={resultDialog()?.variant || "default"}
        onConfirm={() => setResultDialog(null)}
        onCancel={() => setResultDialog(null)}
      />

    </PageShell>
  );
};

export default ManageSources;
