import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import {
  TbOutlinePlus,
  TbOutlinePencil,
  TbOutlineTrash,
} from "solid-icons/tb";

import { teamService, type TeamUser } from "../../../services/teamService";
import {
  Alert,
  BlockingOverlay,
  Button,
  ConfirmModal,
  EditModal,
  IconButton,
} from "../../../components/ui";

export type Agency = { 
  code: string; 
  name: string 
};

type ManageAgenciesProps = {
  agencies: Agency[];
  users: TeamUser[];
  onRefetchAgencies: () => void | Promise<unknown>;
  onRefreshUsers: () => void | Promise<void>;
  showList?: boolean;
  addAgencyRequested?: () => boolean;
  setAddAgencyRequested?: (value: boolean) => void;
  editAgency?: () => Agency | null;
  setEditAgency?: (value: Agency | null) => void;
  deleteAgency?: () => Agency | null;
  setDeleteAgency?: (value: Agency | null) => void;
};

const ManageAgencies: Component<ManageAgenciesProps> = (props) => {
  const [showAgencyForm, setShowAgencyForm] = createSignal(false);
  const [editingAgency, setEditingAgency] = createSignal<Agency | null>(null);
  const [agencyId, setAgencyId] = createSignal("");
  const [agencyName, setAgencyName] = createSignal("");
  const [agencySaving, setAgencySaving] = createSignal(false);
  const [agencyError, setAgencyError] = createSignal("");
  const [agencySuccess, setAgencySuccess] = createSignal("");
  const [showDeleteAgency, setShowDeleteAgency] = createSignal(false);
  const [deletingAgency, setDeletingAgency] = createSignal<Agency | null>(null);
  const [deleteOpenedFromEdit, setDeleteOpenedFromEdit] = createSignal(false);
  const [reassignSelections, setReassignSelections] = createSignal<
    Record<string, string>
  >({});
  const [reassignSaving, setReassignSaving] = createSignal(false);
  const [reassignError, setReassignError] = createSignal("");
  const [resultDialog, setResultDialog] = createSignal<{
    title: string;
    message: string;
    variant: "admin" | "danger";
  } | null>(null);
  const [agencyIdTouched, setAgencyIdTouched] = createSignal(false);
  const [agencyNameTouched, setAgencyNameTouched] = createSignal(false);

  const safeString = (value: any) =>
    value === undefined || value === null ? "" : String(value);

  const isAgencyCodeValid = createMemo(() => {
    const value = agencyId().trim();
    return !!value && /^\d+$/.test(value);
  });

  const isAgencyNameValid = createMemo(() => {
    return !!agencyName().trim();
  });

  const isAgencyFormValid = createMemo(
    () => isAgencyCodeValid() && isAgencyNameValid()
  );

  createEffect(() => {
    const message = agencyError();
    if (!message) return;
    setResultDialog({
      title: "Error",
      message,
      variant: "danger",
    });
    setAgencyError("");
  });

  createEffect(() => {
    const message = agencySuccess();
    if (!message) return;
    setResultDialog({
      title: "Success",
      message,
      variant: "admin",
    });
    setAgencySuccess("");
  });

  createEffect(() => {
    const message = reassignError();
    if (!message) return;
    setResultDialog({
      title: "Error",
      message,
      variant: "danger",
    });
    setReassignError("");
  });

  const showList = () => props.showList !== false;

  createEffect(() => {
    if (!props.addAgencyRequested?.()) return;
    openAddAgency();
    props.setAddAgencyRequested?.(false);
  });

  createEffect(() => {
    const agency = props.editAgency?.();
    if (!agency) return;
    openEditAgency(agency);
    props.setEditAgency?.(null);
  });

  createEffect(() => {
    const agency = props.deleteAgency?.();
    if (!agency) return;
    openDeleteAgency(agency);
    props.setDeleteAgency?.(null);
  });

  const agencyNumericValue = (code: string) => {
    const digits = code.replace(/\D/g, "");
    const value = Number(digits);
    return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
  };

  const getDefaultAgencyId = (excludeId?: string) => {
    const list = props.agencies.filter((agency) => agency.code !== excludeId);
    if (!list.length) return "";
    const sorted = [...list].sort((a, b) => {
      const diff = agencyNumericValue(a.code) - agencyNumericValue(b.code);
      if (diff !== 0) return diff;
      return a.code.localeCompare(b.code);
    });
    return sorted[0]?.code || "";
  };

  const availableAgencies = createMemo(() => {
    const current = deletingAgency();
    return props.agencies.filter((agency) => agency.code !== current?.code);
  });

  const deleteAgencyMembers = createMemo(() => {
    const current = deletingAgency();
    if (!current) return [];
    return props.users.filter(
      (user) => safeString(user.agencyCode).trim() === current.code
    );
  });

  const openAddAgency = () => {
    setEditingAgency(null);
    setAgencyId("");
    setAgencyName("");
    setAgencyIdTouched(false);
    setAgencyNameTouched(false);
    setAgencyError("");
    setAgencySuccess("");
    setShowAgencyForm(true);
  };

  const openEditAgency = (agency: Agency) => {
    setEditingAgency(agency);
    setAgencyId(agency.code);
    setAgencyName(agency.name || "");
    setAgencyIdTouched(false);
    setAgencyNameTouched(false);
    setAgencyError("");
    setAgencySuccess("");
    setShowAgencyForm(true);
  };

  const closeAgencyForm = () => {
    setShowAgencyForm(false);
    setEditingAgency(null);
    setAgencyId("");
    setAgencyName("");
    setAgencyIdTouched(false);
    setAgencyNameTouched(false);
    setAgencyError("");
  };

  const handleSaveAgency = async () => {
    const id = agencyId().trim();
    if (!id) {
      setAgencyError("Agency code is required");
      setAgencyIdTouched(true);
      return;
    }
    if (!/^\d+$/.test(id)) {
      setAgencyError("Agency code must be digits only");
      setAgencyIdTouched(true);
      return;
    }
    if (!agencyName().trim()) {
      setAgencyError("Agency name is required");
      setAgencyNameTouched(true);
      return;
    }

    const current = editingAgency();
    const existing = props.agencies.find((agency) => agency.code === id);
    if (current && current.code !== id && existing) {
      setAgencyError("Agency code already exists");
      return;
    }

    const members = current
      ? props.users.filter(
          (user) => safeString(user.agencyCode).trim() === current.code
        )
      : [];

    setAgencySaving(true);
    setAgencyError("");
    setAgencySuccess("");
    try {
      if (current && current.code !== id) {
        if (members.length) {
          await teamService.bulkUpdateUsers({
            updates: members.map((user) => ({
              uid: user.id,
              agencyCode: id,
            })),
          });
        }
        await teamService.upsertAgency({ code: id, name: agencyName().trim() });
        await teamService.removeAgency(current.code);
      } else {
        await teamService.upsertAgency({ code: id, name: agencyName().trim() });
      }
      await props.onRefetchAgencies();
      await props.onRefreshUsers();
      setAgencySuccess(
        `Agency ${current ? "updated" : "created"} successfully`
      );
      closeAgencyForm();
    } catch (err: any) {
      console.error("Failed to save agency", err);
      const message =
        typeof err?.message === "string" && err.message.trim()
          ? err.message
          : "Failed to save agency";
      setAgencyError(message);
    } finally {
      setAgencySaving(false);
    }
  };

  const openDeleteAgency = (agency: Agency, fromEdit = false) => {
    setDeleteOpenedFromEdit(fromEdit);
    setDeletingAgency(agency);
    const members = props.users.filter(
      (user) => safeString(user.agencyCode).trim() === agency.code
    );
    const defaultAgency = getDefaultAgencyId(agency.code);
    const selections: Record<string, string> = {};
    members.forEach((user) => {
      selections[user.id] = defaultAgency;
    });
    setReassignSelections(selections);
    setReassignError("");
    setShowDeleteAgency(true);
  };

  const closeDeleteAgency = () => {
    setShowDeleteAgency(false);
    setDeletingAgency(null);
    setReassignSelections({});
    setReassignError("");
    setDeleteOpenedFromEdit(false);
  };

  const handleConfirmDeleteAgency = async () => {
    const agency = deletingAgency();
    if (!agency) return;
    const members = deleteAgencyMembers();
    const targets = availableAgencies();

    if (members.length && !targets.length) {
      setReassignError("Create another agency before deleting this one.");
      return;
    }

    const selections = reassignSelections();
    const missing = members.find((user) => !selections[user.id]);
    if (missing) {
      const label = safeString(missing.nickname).trim() || missing.id;
      setReassignError(`Select a new agency for ${label}.`);
      return;
    }

    setReassignSaving(true);
    setReassignError("");
    try {
      if (members.length) {
        await teamService.bulkUpdateUsers({
          updates: members.map((user) => ({
            uid: user.id,
            agencyCode: selections[user.id],
          })),
        });
      }
      await teamService.removeAgency(agency.code);
      await props.onRefetchAgencies();
      await props.onRefreshUsers();
      setAgencySuccess(`Agency ${agency.code} deleted successfully`);
      const wasOpenedFromEdit = deleteOpenedFromEdit();
      closeDeleteAgency();
      if (wasOpenedFromEdit) {
        closeAgencyForm();
      }
    } catch (err: any) {
      console.error("Failed to delete agency", err);
      const message =
        typeof err?.message === "string" && err.message.trim()
          ? err.message
          : "Failed to delete agency. Please try again.";
      setReassignError(message);
    } finally {
      setReassignSaving(false);
    }
  };

  return (
    <div>
      <Show when={showList()}>
        <div class="mb-3 flex items-center justify-between">
          <div class="text-base font-semibold text-gray-800">Agencies</div>
          <button
            type="button"
            onClick={openAddAgency}
            class="flex items-center gap-2 rounded-lg bg-admin-from px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-to"
          >
            <TbOutlinePlus class="h-4 w-4" />
            Add Agency
          </button>
        </div>
        <div class="space-y-2">
          <For each={props.agencies}>
            {(agency) => (
              <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-700 shadow-sm">
                <div class="min-w-0">
                  <div class="font-semibold text-gray-900">{agency.code}</div>
                  <div class="text-sm text-gray-500">{agency.name || "—"}</div>
                </div>
                <div class="flex items-center gap-2">
                  <IconButton
                    type="button"
                    variant="adminOutline"
                    onClick={() => openEditAgency(agency)}
                    aria-label="Edit agency"
                  >
                    <TbOutlinePencil class="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant="ghost"
                    onClick={() => openDeleteAgency(agency)}
                    disabled={agencySaving()}
                    class="text-red-600 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete agency"
                  >
                    <TbOutlineTrash class="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={showAgencyForm()}>
        <EditModal
          title={editingAgency() ? "Edit Agency" : "Add Agency"}
          onClose={closeAgencyForm}
          onSave={handleSaveAgency}
          saving={() => agencySaving()}
          saveDisabled={agencySaving() || !isAgencyFormValid()}
          saveLabel="Save"
          savingLabel="Saving..."
          bodyClass="pb-6 pt-4"
        >
          <div class="space-y-4">
              <div>
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Agency Code
                </label>
                <input
                  type="text"
                  value={agencyId()}
                  onInput={(e) => {
                    setAgencyId(e.currentTarget.value);
                    setAgencyIdTouched(true);
                  }}
                  placeholder="e.g. 01"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                />
                <Show when={agencyIdTouched() && !isAgencyCodeValid()}>
                  <p class="mt-1 text-sm text-red-600">
                    Agency code must be digits only.
                  </p>
                </Show>
              </div>
              <div>
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Agency Name
                </label>
                <input
                  type="text"
                  value={agencyName()}
                  onInput={(e) => {
                    setAgencyName(e.currentTarget.value);
                    setAgencyNameTouched(true);
                  }}
                  placeholder="Agency Name"
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                />
                <Show when={agencyNameTouched() && !isAgencyNameValid()}>
                  <p class="mt-1 text-sm text-red-600">
                    Agency name is required.
                  </p>
                </Show>
              </div>
          </div>
        </EditModal>
      </Show>

      <Show when={showDeleteAgency()}>
        <EditModal
          title="Reassign members"
          onClose={closeDeleteAgency}
          onSave={handleConfirmDeleteAgency}
          saving={() => reassignSaving()}
          footerSticky
          saveVariant="danger"
          saveLabel="Delete"
          saveDisabled={
            reassignSaving() ||
            (!availableAgencies().length && deleteAgencyMembers().length > 0)
          }
          bodyClass="pt-4"
          footerLeft={
            <Button variant="secondary" size="lg" onClick={closeDeleteAgency}>
              Cancel
            </Button>
          }
        >
          <div class="space-y-4">
            <p class="text-base font-semibold text-gray-900">
              Reassign members before deleting {deletingAgency()?.code} -{" "}
              {deletingAgency()?.name}
            </p>

            <Show
              when={!availableAgencies().length && deleteAgencyMembers().length}
            >
              <Alert type="error">
                Create another agency before deleting this one.
              </Alert>
            </Show>

            <div class="divide-y divide-gray-200 border-y border-gray-200">
              <Show
                when={deleteAgencyMembers().length}
                fallback={
                  <div class="py-4 text-base text-gray-600">
                    No members in this agency.
                  </div>
                }
              >
                <For each={deleteAgencyMembers()}>
                  {(member) => (
                    <div class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                      <div class="min-w-0">
                        <div class="text-base font-semibold text-gray-900">
                          {safeString(member.nickname).trim() ||
                            safeString(member.email).trim() ||
                            member.id}
                        </div>
                        <div class="text-sm text-gray-500">
                          {safeString(member.fscCode).trim() || "—"}
                          {safeString(member.email).trim()
                            ? ` • ${safeString(member.email).trim()}`
                            : ""}
                        </div>
                      </div>
                      <select
                        value={reassignSelections()[member.id] || ""}
                        onChange={(e) =>
                          setReassignSelections((prev) => ({
                            ...prev,
                            [member.id]: e.currentTarget.value,
                          }))
                        }
                        class="sm:ml-auto w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 shadow-sm focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40 sm:w-64"
                      >
                        <For each={availableAgencies()}>
                          {(agency) => (
                            <option value={agency.code}>
                              {agency.code}
                              {agency.name ? ` — ${agency.name}` : ""}
                            </option>
                          )}
                        </For>
                      </select>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </EditModal>
      </Show>
      <BlockingOverlay
        open={agencySaving() || reassignSaving()}
        title={reassignSaving() ? "Deleting agency..." : "Saving agency..."}
        message="Please wait while your request is being processed."
      />
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
    </div>
  );
};

export default ManageAgencies;
