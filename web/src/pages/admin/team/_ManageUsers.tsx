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
  TbOutlineBuilding,
  TbOutlineChevronDown,
} from "solid-icons/tb";

import {
  teamService,
  isStaffUser,
  type CreateUserPayload,
  type UpdateUserPayload,
  type TeamUser,
  type TeamAgency
} from "../../../services/teamService";
import {
  Alert,
  BlockingOverlay,
  ConfirmModal,
  EditModal,
  IconButton,
  LoadingState,
  createConfirm,
} from "../../../components/ui";

type ManageUsersProps = {
  users: TeamUser[];
  usersLoading: boolean;
  usersError: unknown;
  agencies: TeamAgency[];
  showForm: () => boolean;
  setShowForm: (value: boolean) => void;
  showList?: boolean;
  addUserRequested?: () => boolean;
  setAddUserRequested?: (value: boolean) => void;
  editUser?: () => TeamUser | null;
  setEditUser?: (value: TeamUser | null) => void;
  deleteUser?: () => TeamUser | null;
  setDeleteUser?: (value: TeamUser | null) => void;
  onRefresh: () => void | Promise<void>;
};

type UserFormErrors = Partial<
  Record<
    "email" | "fscCode" | "agencyCode" | "nickname" | "birthDate" | "contractDate",
    string
  >
>;
type UserFieldKey = keyof UserFormErrors;

const ManageUsers: Component<ManageUsersProps> = (props) => {
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");
  const [editingUser, setEditingUser] = createSignal<TeamUser | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [fieldErrors, setFieldErrors] = createSignal<UserFormErrors>({});
  const [resultDialog, setResultDialog] = createSignal<{
    title: string;
    message: string;
    variant: "admin" | "danger";
  } | null>(null);
  const [searchTerm, setSearchTerm] = createSignal("");
  const [openAgencies, setOpenAgencies] = createSignal<Record<string, boolean>>(
    {},
  );

  // Form fields
  const [formId, setFormId] = createSignal("");
  const [formEmail, setFormEmail] = createSignal("");
  const [formNickname, setFormNickname] = createSignal("");
  const [formFullName, setFormFullName] = createSignal("");
  const [formFscCode, setFormFscCode] = createSignal("");
  const [formAgencyCode, setFormAgencyCode] = createSignal("");
  const [formAccessLevel, setFormAccessLevel] = createSignal("");
  const [formBirthDate, setFormBirthDate] = createSignal("");
  const [formContractDate, setFormContractDate] = createSignal("");

  const safeString = (value: any) =>
    value === undefined || value === null ? "" : String(value);

  const sanitizeFscInput = (value: string) =>
    value.replace(/\D/g, "").slice(0, 5);
  const clearFieldError = (key: keyof UserFormErrors) =>
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  const setFieldError = (key: UserFieldKey, value?: string) =>
    setFieldErrors((prev) => ({ ...prev, [key]: value }));

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const formatDateFromParts = (
    day?: number | null,
    month?: number | null,
    year?: number | null,
  ) => {
    if (!day || !month || !year) return "";
    return `${pad2(day)}/${pad2(month)}/${year}`;
  };

  const formatDateInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) {
      return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const parseDateInput = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 8) return null;
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));
    if (
      !day ||
      day > 31 ||
      !month ||
      month > 12 ||
      year < 1900 ||
      year > 2100
    ) {
      return null;
    }
    return { day, month, year };
  };

  const sanitizedNickname = () => safeString(formNickname()).trim();
  const sanitizedEmail = () => safeString(formEmail()).trim().toLowerCase();
  const sanitizedFsc = () => sanitizeFscInput(safeString(formFscCode()));
  const sanitizedAgency = () => safeString(formAgencyCode()).trim();
  const sanitizedAccess = () =>
    safeString(formAccessLevel()).trim().toLowerCase();
  const normalizeAccessValue = (value?: string) => {
    const normalized = safeString(value).trim().toLowerCase();
    return normalized === "standard" ? "" : normalized;
  };
  const normalizedAccess = () => {
    const value = sanitizedAccess();
    return value === "standard" ? "" : value;
  };

  const isAddFormValid = () => {
    const email = sanitizedEmail();
    const fsc = sanitizedFsc();
    const agency = sanitizedAgency();
    return Boolean(emailRegex.test(email) && /^\d{5}$/.test(fsc) && agency);
  };

  const getFieldError = (key: UserFieldKey): string | undefined => {
    const isEdit = !!editingUser();
    switch (key) {
      case "email": {
        const email = sanitizedEmail();
        if (!emailRegex.test(email)) return "Enter a valid email address.";
        return undefined;
      }
      case "agencyCode":
        return sanitizedAgency() ? undefined : "Agency is required.";
      case "fscCode": {
        const fsc = sanitizedFsc();
        if (!isEdit && !/^\d{5}$/.test(fsc)) {
          return "FSC code must be exactly 5 digits.";
        }
        if (isEdit && fsc && !/^\d{5}$/.test(fsc)) {
          return "FSC code must be exactly 5 digits.";
        }
        return undefined;
      }
      case "nickname": {
        if (!isEdit) return undefined;
        return sanitizedNickname().length > 15
          ? "Nickname must be 15 characters or fewer."
          : undefined;
      }
      case "birthDate": {
        if (!isEdit) return undefined;
        return formBirthDate().trim() && !parseDateInput(formBirthDate())
          ? "Birth date must be in DD/MM/YYYY format."
          : undefined;
      }
      case "contractDate": {
        if (!isEdit) return undefined;
        return formContractDate().trim() && !parseDateInput(formContractDate())
          ? "Contract date must be in DD/MM/YYYY format."
          : undefined;
      }
      default:
        return undefined;
    }
  };

  const validateField = (key: UserFieldKey) => {
    setFieldError(key, getFieldError(key));
  };

  const isEditChanged = () => {
    const base = editingUser();
    if (!base) return false;
    const baseAccess = normalizeAccessValue(base.accessLevel);
    const currentAccess = sanitizedAccess() || "";
    return (
      sanitizedNickname() !== safeString(base.nickname).trim() ||
      sanitizedEmail() !== safeString(base.email).trim().toLowerCase() ||
      sanitizedFsc() !== sanitizeFscInput(safeString(base.fscCode)) ||
      sanitizedAgency() !== safeString(base.agencyCode).trim() ||
      currentAccess !== baseAccess ||
      formatDateFromParts(base.birthDay, base.birthMonth, base.birthYear) !==
        formBirthDate().trim() ||
      formatDateFromParts(
        base.contractDay,
        base.contractMonth,
        base.contractYear,
      ) !== formContractDate().trim()
    );
  };

  const isEditFormValid = () => {
    const nickname = sanitizedNickname();
    const email = sanitizedEmail();
    const fsc = sanitizedFsc();
    if (nickname.length > 15) return false;
    if (!emailRegex.test(email)) return false;
    if (fsc && !/^\d{5}$/.test(fsc)) return false;
    if (!sanitizedAgency()) return false;
    const birthOk =
      !formBirthDate().trim() || Boolean(parseDateInput(formBirthDate()));
    const contractOk =
      !formContractDate().trim() || Boolean(parseDateInput(formContractDate()));
    if (!birthOk || !contractOk) return false;
    return true;
  };

  const isSaveDisabled = createMemo(() => {
    if (saving()) return true;
    if (!editingUser()) return !isAddFormValid();
    return !isEditFormValid() || !isEditChanged();
  });

  const accessLabel = (value?: string) => {
    if (!value) return "Standard";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const agencyNameMap = createMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    props.agencies.forEach((agency) => {
      map[agency.code] = agency.name || "";
    });
    return map;
  });

  const filteredUsers = createMemo(() => {
    const term = searchTerm().toLowerCase().trim();
    const userList = props.users ?? [];
    if (!term) return userList;
    return userList.filter((user) =>
      `${user.nickname || ""} ${user.email || ""} ${user.fscCode || ""} ${
        user.agencyCode || ""
      } ${user.accessLevel || ""}`
        .toLowerCase()
        .includes(term),
    );
  });

  const groupedUsers = createMemo(() => {
    const groups = new Map<string, TeamUser[]>();
    filteredUsers().forEach((user) => {
      const key = user.agencyCode || "Unassigned";
      const existing = groups.get(key);
      if (existing) {
        existing.push(user);
      } else {
        groups.set(key, [user]);
      }
    });

    const fscNumber = (value?: string) => {
      const digits = safeString(value).replace(/\D/g, "");
      const parsed = Number(digits);
      return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
    };

    const agencyOrder = props.agencies.map((agency) => agency.code);
    const orderedKeys = [
      ...agencyOrder.filter((code) => groups.has(code)),
      ...Array.from(groups.keys()).filter(
        (code) => !agencyOrder.includes(code),
      ),
    ];

    return orderedKeys.map((agency) => {
        const members = groups.get(agency) || [];
        const staffCount = members.filter((member) =>
          isStaffUser(member.fscCode),
        ).length;
        const agentCount = members.length - staffCount;
        return {
          agency,
          agencyName: agencyNameMap()[agency] || "",
          staffCount,
          agentCount,
          members: members.sort((a, b) => {
            const diff = fscNumber(a.fscCode) - fscNumber(b.fscCode);
            if (diff !== 0) return diff;
            return (a.nickname || "").localeCompare(
              b.nickname || "",
              undefined,
              {
                sensitivity: "base",
              },
            );
          }),
          total: members.length,
        };
      });
  });

  createEffect(() => {
    const groups = groupedUsers();
    if (!groups.length) return;
    setOpenAgencies((prev) => {
      const next = { ...prev };
      groups.forEach((group) => {
        if (next[group.agency] === undefined) {
          next[group.agency] = false;
        }
      });
      return next;
    });
  });

  createEffect(() => {
    const term = searchTerm().trim();
    setOpenAgencies((prev) => {
      const next = { ...prev };
      groupedUsers().forEach((group) => {
        next[group.agency] = term ? true : false;
      });
      return next;
    });
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

  const showList = () => props.showList !== false;

  createEffect(() => {
    if (!props.addUserRequested?.()) return;
    openAddForm();
    props.setAddUserRequested?.(false);
  });

  createEffect(() => {
    const user = props.editUser?.();
    if (!user) return;
    openEditForm(user);
    props.setEditUser?.(null);
  });

  createEffect(() => {
    const user = props.deleteUser?.();
    if (!user) return;
    handleDelete(user);
    props.setDeleteUser?.(null);
  });

  const resetForm = () => {
    setFormId("");
    setFormEmail("");
    setFormNickname("");
    setFormFullName("");
    setFormFscCode("");
    setFormAgencyCode("");
    setFormAccessLevel("");
    setFormBirthDate("");
    setFormContractDate("");
    setFieldErrors({});
    setEditingUser(null);
  };

  const openAddForm = () => {
    resetForm();
    props.setShowForm(true);
  };

  const openEditForm = (user: TeamUser) => {
    setFormId(user.id);
    setFormEmail(user.email || "");
    setFormNickname(safeString(user.nickname).slice(0, 15));
    setFormFullName(safeString(user.fullName));
    setFormFscCode(sanitizeFscInput(safeString(user.fscCode)));
    setFormAgencyCode(user.agencyCode || "");
    setFormAccessLevel(normalizeAccessValue(user.accessLevel));
    setFormBirthDate(
      formatDateFromParts(user.birthDay, user.birthMonth, user.birthYear),
    );
    setFormContractDate(
      formatDateFromParts(
        user.contractDay,
        user.contractMonth,
        user.contractYear,
      ),
    );
    setEditingUser(user);
    props.setShowForm(true);
  };

  const closeForm = () => {
    props.setShowForm(false);
    resetForm();
  };

  const handleSave = async (e?: Event) => {
    e?.preventDefault();
    setError("");
    setSuccess("");
    setFieldErrors({});

    const isEdit = !!editingUser();

    const email = sanitizedEmail();
    const fsc = sanitizedFsc();
    const agency = sanitizedAgency();
    const nickname = sanitizedNickname();
    const keys: UserFieldKey[] = [
      "email",
      "agencyCode",
      "fscCode",
      ...(isEdit ? (["nickname", "birthDate", "contractDate"] as UserFieldKey[]) : []),
    ];
    const nextErrors: UserFormErrors = {};
    keys.forEach((key) => {
      const message = getFieldError(key);
      if (message) nextErrors[key] = message;
    });

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      if (!isEdit) {
        const payload: CreateUserPayload = {
          email,
          fscCode: fsc,
          agencyCode: agency,
          accessLevel: normalizedAccess(),
        };
        await teamService.createUser(payload);
        setSuccess("User created and added to directory");
      } else {
        const userId = formId();
        if (!userId) {
          setError("User ID is required");
          return;
        }

        const toIsoDate = (value: string) => {
          if (!value.trim()) return "";
          const parsed = parseDateInput(value);
          if (!parsed) return "";
          const padIso = (num: number) => String(num).padStart(2, "0");
          return `${parsed.year}-${padIso(parsed.month)}-${padIso(parsed.day)}`;
        };

        const payload: UpdateUserPayload = {
          uid: userId,
          email,
          nickname: nickname || "",
          fullName: formFullName().trim(),
          fscCode: fsc || "",
          agencyCode: agency,
          accessLevel: normalizedAccess(),
          birthDate: toIsoDate(formBirthDate()),
          contractDate: toIsoDate(formContractDate()),
        };
        await teamService.updateUser(payload);
        const label = nickname || email || userId;
        setSuccess(`User ${label} updated successfully`);
      }

      await props.onRefresh();
      setSearchTerm("");
      closeForm();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      console.error("Failed to save user", err);
      setError(`Failed to ${isEdit ? "update" : "add"} user: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const [DeleteUserModal, confirmDeleteUser] = createConfirm({
    title: "Delete user",
    message: "Are you sure you want to delete this user?",
    confirmLabel: "Delete",
    variant: "danger",
  });

  const handleDelete = async (user: TeamUser) => {
    if (!(await confirmDeleteUser())) return;

    setError("");
    setSuccess("");
    setDeleting(true);
    try {
      await teamService.deleteUser(user.id);
      const label =
        safeString(user.nickname).trim() ||
        safeString(user.email).trim() ||
        user.id;
      setSuccess(`User ${label} deleted successfully`);
      await props.onRefresh();
      if (props.showForm() && editingUser()?.id === user.id) {
        closeForm();
      }
    } catch (err: any) {
      console.error("Failed to delete user", err);
      setError(`Failed to delete user: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="space-y-4">
      <Show when={props.showForm()}>
        <EditModal
          title={editingUser() ? "Edit User" : "Add New User"}
          onClose={closeForm}
          onSave={() => handleSave()}
          saving={() => saving()}
          saveDisabled={isSaveDisabled()}
          saveLabel="Save"
          bodyClass="pb-6 pt-4"
        >
          <form onSubmit={handleSave} class="space-y-4">
            <Show
              when={editingUser()}
              fallback={
                <div class="space-y-4">
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label class="mb-2 block text-base font-medium text-gray-700">
                        Email <span class="text-red-600">*</span>
                      </label>
                      <input
                        type="email"
                        value={formEmail()}
                        onInput={(e) => {
                          setFormEmail(e.currentTarget.value);
                          clearFieldError("email");
                        }}
                        onBlur={() => validateField("email")}
                        required
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <Show when={fieldErrors().email}>
                        <p class="mt-1 text-sm text-red-600">{fieldErrors().email}</p>
                      </Show>
                    </div>
                    <div>
                      <label class="mb-2 block text-base font-medium text-gray-700">
                        Agency <span class="text-red-600">*</span>
                      </label>
                      <select
                        value={formAgencyCode()}
                        onChange={(e) =>
                          {
                            setFormAgencyCode(e.currentTarget.value);
                            clearFieldError("agencyCode");
                          }
                        }
                        onBlur={() => validateField("agencyCode")}
                        required
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="">Select agency</option>
                        <For each={props.agencies}>
                          {(agency) => (
                            <option value={agency.code}>
                              {agency.code}{" "}
                              {agency.name ? `— ${agency.name}` : ""}
                            </option>
                          )}
                        </For>
                      </select>
                      <Show when={fieldErrors().agencyCode}>
                        <p class="mt-1 text-sm text-red-600">{fieldErrors().agencyCode}</p>
                      </Show>
                    </div>
                    <div class="grid gap-4">
                      <div>
                        <label class="mb-2 block text-base font-medium text-gray-700">
                          Access Level <span class="text-red-600">*</span>
                        </label>
                      <select
                        value={formAccessLevel()}
                        onChange={(e) =>
                          setFormAccessLevel(e.currentTarget.value)
                        }
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-admin-from focus:outline-none focus:ring-2 focus:ring-admin-from/40"
                      >
                          <option value="">Standard</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>{" "}
                    <div>
                      <label class="mb-2 block text-base font-medium text-gray-700">
                        FSC Code <span class="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={formFscCode()}
                        inputMode="numeric"
                        maxLength={5}
                        onInput={(e) =>
                          {
                            setFormFscCode(
                              sanitizeFscInput(e.currentTarget.value),
                            );
                            clearFieldError("fscCode");
                          }
                        }
                        onBlur={() => validateField("fscCode")}
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <Show when={fieldErrors().fscCode}>
                        <p class="mt-1 text-sm text-red-600">{fieldErrors().fscCode}</p>
                      </Show>
                    </div>
                  </div>

                  <div class="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-base text-amber-900">
                    <p>
                      To add a non-agent staff, key in any unique FSC code
                      starting with 00.
                    </p>
                  </div>
                  <div class="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-base text-amber-900">
                    <p>
                      After adding users, you may direct them to download the
                      app from https://hub.mfag.sg.
                    </p>
                    <p>
                      <br />
                      They will login with their FSC code and email, and will be immediately prompted to
                      fill up their other information (nickame, full name birthday, contract date).
                    </p>
                  </div>
                </div>
              }
            >
              <div class="space-y-4">
                <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-700">
                  <div class="font-semibold text-gray-900">User ID</div>
                  <div class="mt-1 font-mono text-sm text-gray-600">
                    {formId()}
                  </div>
                </div>
                <div class="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Nickname
                    </label>
                    <input
                      type="text"
                      value={formNickname()}
                      maxLength={15}
                      onInput={(e) => {
                        setFormNickname(e.currentTarget.value.slice(0, 15));
                        clearFieldError("nickname");
                      }}
                      onBlur={() => validateField("nickname")}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Show when={fieldErrors().nickname}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().nickname}</p>
                    </Show>
                  </div>
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={formFullName()}
                      onInput={(e) => setFormFullName(e.currentTarget.value)}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Email <span class="text-red-600">*</span>
                    </label>
                    <input
                      type="email"
                      value={formEmail()}
                      onInput={(e) => {
                        setFormEmail(e.currentTarget.value);
                        clearFieldError("email");
                      }}
                      onBlur={() => validateField("email")}
                      required
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Show when={fieldErrors().email}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().email}</p>
                    </Show>
                  </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Agency <span class="text-red-600">*</span>
                    </label>
                    <select
                      value={formAgencyCode()}
                      onChange={(e) => {
                        setFormAgencyCode(e.currentTarget.value);
                        clearFieldError("agencyCode");
                      }}
                      onBlur={() => validateField("agencyCode")}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">Select agency</option>
                      <For each={props.agencies}>
                        {(agency) => (
                          <option value={agency.code}>
                            {agency.code} {agency.name ? `— ${agency.name}` : ""}
                          </option>
                        )}
                      </For>
                    </select>
                    <Show when={fieldErrors().agencyCode}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().agencyCode}</p>
                    </Show>
                  </div>
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      FSC Code
                    </label>
                    <input
                      type="text"
                      value={formFscCode()}
                      inputMode="numeric"
                      maxLength={5}
                      onInput={(e) =>
                        {
                          setFormFscCode(sanitizeFscInput(e.currentTarget.value));
                          clearFieldError("fscCode");
                        }
                      }
                      onBlur={() => validateField("fscCode")}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Show when={fieldErrors().fscCode}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().fscCode}</p>
                    </Show>
                  </div>
                </div>

                <div class="space-y-4">
                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Birthday
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="DD/MM/YYYY"
                      value={formBirthDate()}
                      onInput={(e) => {
                        setFormBirthDate(formatDateInput(e.currentTarget.value));
                        clearFieldError("birthDate");
                      }}
                      onBlur={() => validateField("birthDate")}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Show when={fieldErrors().birthDate}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().birthDate}</p>
                    </Show>
                  </div>

                  <div>
                    <label class="mb-2 block text-base font-medium text-gray-700">
                      Contract Date
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="DD/MM/YYYY"
                      value={formContractDate()}
                      onInput={(e) => {
                        setFormContractDate(
                          formatDateInput(e.currentTarget.value),
                        );
                        clearFieldError("contractDate");
                      }}
                      onBlur={() => validateField("contractDate")}
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Show when={fieldErrors().contractDate}>
                      <p class="mt-1 text-sm text-red-600">{fieldErrors().contractDate}</p>
                    </Show>
                  </div>
                </div>

                <div>
                  <label class="mb-2 block text-base font-medium text-gray-700">
                    Access Level
                  </label>
                  <select
                    value={formAccessLevel()}
                    onChange={(e) => setFormAccessLevel(e.currentTarget.value)}
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-admin-from focus:outline-none focus:ring-2 focus:ring-admin-from/40"
                  >
                    <option value="">Standard</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            </Show>

          </form>
        </EditModal>
      </Show>

      <Show when={!props.showForm() && showList()}>
        <Show
          when={!props.usersLoading}
          fallback={
            <div class="py-6">
              <LoadingState label="Loading users..." />
            </div>
          }
        >
          <Show when={props.usersError}>
            <Alert type="error">Unable to load users right now.</Alert>
          </Show>
          <div class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="text-base font-semibold text-gray-800">
                  Team Directory
                </div>
              </div>
              <button
                type="button"
                onClick={openAddForm}
                class="ml-auto flex items-center gap-2 rounded-lg bg-admin-from px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-to"
              >
                <TbOutlinePlus class="h-4 w-4" />
                Add User
              </button>
            </div>
            <div>
              <input
                type="search"
                value={searchTerm()}
                onInput={(e) => setSearchTerm(e.currentTarget.value)}
                placeholder="Search by nickname, FSC, agency, access…"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 shadow-sm focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
              />
            </div>

            <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead class="bg-primary/5 border-b border-gray-200">
                    <tr>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Actions
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Nickname
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        FSC Code
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Agency
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Access
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Full Name
                      </th>
                      <th class="px-4 py-3 text-left text-sm font-semibold uppercase text-gray-700">
                        Email
                      </th>
                    </tr>
                  </thead>
                  <For each={groupedUsers()}>
                    {(group) => (
                      <tbody class="divide-y divide-gray-100">
                        <tr class="bg-gray-50">
                          <td colSpan={7} class="px-4 py-0">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenAgencies((prev) => ({
                                  ...prev,
                                  [group.agency]: !prev[group.agency],
                                }))
                              }
                              class="flex w-full items-center gap-2 py-2 text-left"
                            >
                              <TbOutlineChevronDown
                                class={`h-4 w-4 text-gray-400 transition-transform ${
                                  openAgencies()[group.agency]
                                    ? "rotate-180"
                                    : ""
                                }`}
                              />
                              <TbOutlineBuilding class="h-4 w-4 text-primary" />
                              <div class="flex-1 text-sm font-semibold uppercase text-gray-500">
                                {group.agency}
                                {group.agencyName
                                  ? ` — ${group.agencyName}`
                                  : ""}{" "}
                                <span class="text-[11px] text-gray-400">
                                  ({group.agentCount} agent
                                  {group.agentCount === 1 ? "" : "s"}
                                  {group.staffCount
                                    ? `, ${group.staffCount} staff`
                                    : ""}
                                  )
                                </span>
                              </div>
                            </button>
                          </td>
                        </tr>
                        <Show when={openAgencies()[group.agency]}>
                          <For each={group.members}>
                            {(user) => (
                              <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 text-right">
                                  <div class="flex items-center justify-start gap-2">
                                    <IconButton
                                      type="button"
                                      variant="adminOutline"
                                      onClick={() => openEditForm(user)}
                                      aria-label="Edit user"
                                    >
                                      <TbOutlinePencil class="h-4 w-4" />
                                    </IconButton>
                                    <IconButton
                                      type="button"
                                      variant="ghost"
                                      onClick={() => handleDelete(user)}
                                      class="text-red-600 hover:bg-red-50 hover:text-red-600"
                                      aria-label="Delete user"
                                    >
                                      <TbOutlineTrash class="h-4 w-4" />
                                    </IconButton>
                                  </div>
                                </td>
                                <td class="px-4 py-3 text-base font-semibold text-gray-900">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <span>{user.nickname || "—"}</span>
                                    <Show when={isStaffUser(user.fscCode)}>
                                      <span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                                        Staff
                                      </span>
                                    </Show>
                                  </div>
                                </td>
                                <td class="px-4 py-3 text-base text-gray-600">
                                  {user.fscCode || "—"}
                                </td>
                                <td class="px-4 py-3 text-base text-gray-600">
                                  {user.agencyCode || "—"}
                                </td>
                                <td class="px-4 py-3 text-base">
                                  <span
                                    class={`rounded-full px-2 py-0.5 text-sm font-semibold uppercase ${
                                      user.accessLevel === "admin"
                                        ? "bg-orange-100 text-orange-700"
                                        : user.accessLevel === "editor"
                                          ? "bg-green-100 text-green-700"
                                          : "bg-gray-100 text-gray-700"
                                    }`}
                                  >
                                    {accessLabel(user.accessLevel)}
                                  </span>
                                </td>
                                <td class="px-4 py-3 text-base text-gray-600">
                                  {user.fullName || "—"}
                                </td>
                                <td class="px-4 py-3 text-base text-gray-600">
                                  {user.email || "—"}
                                </td>
                              </tr>
                            )}
                          </For>
                        </Show>
                      </tbody>
                    )}
                  </For>
                </table>
              </div>
            </div>
          </div>
        </Show>
      </Show>

      <DeleteUserModal />
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
      <BlockingOverlay
        open={saving() || deleting()}
        title={deleting() ? "Deleting user..." : "Saving user..."}
        message="Please wait while your request is being processed."
      />
    </div>
  );
};

export default ManageUsers;
