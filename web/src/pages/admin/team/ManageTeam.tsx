import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  PageShell,
  PageHeader,
  PageBody,
  BlockingOverlay,
  EditModal,
  IconButton,
  ReorderList,
} from "../../../components/ui";

import { teamService, type TeamAgency } from "../../../services/teamService";
import ManageAgencies from "./_ManageAgencies";
import ManageUsers from "./_ManageUsers";
import type { TeamUser } from "../../../services/teamService";
import {
  adminActionButtonClass,
  adminOptionForPath,
  manageTeamActionOptions,
} from "../adminOptions";
import {
  TbOutlinePencil,
  TbOutlineTrash,
  TbOutlineChevronDown,
} from "solid-icons/tb";
import { getCaptchaAwareErrorMessage } from "../../../services/authService";

const ManageTeam: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const [users, setUsers] = createSignal<TeamUser[]>([]);
  const [agencies, setAgencies] = createSignal<TeamAgency[]>([]);
  const [usersLoading, setUsersLoading] = createSignal(true);
  const [usersError, setUsersError] = createSignal<unknown>(null);
  const [showUserForm, setShowUserForm] = createSignal(false);
  const [showUserPicker, setShowUserPicker] = createSignal(false);
  const [editUserTarget, setEditUserTarget] = createSignal<TeamUser | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = createSignal<TeamUser | null>(
    null,
  );
  const [addUserRequested, setAddUserRequested] = createSignal(false);
  const [showAgencyPicker, setShowAgencyPicker] = createSignal(false);
  const [editAgencyTarget, setEditAgencyTarget] = createSignal<TeamAgency | null>(
    null,
  );
  const [deleteAgencyTarget, setDeleteAgencyTarget] = createSignal<
    TeamAgency | null
  >(null);
  const [addAgencyRequested, setAddAgencyRequested] = createSignal(false);
  const [showReorderAgencies, setShowReorderAgencies] = createSignal(false);
  const [reorderList, setReorderList] = createSignal<TeamAgency[]>([]);
  const [reorderDirty, setReorderDirty] = createSignal(false);
  const [reorderSaving, setReorderSaving] = createSignal(false);
  const [userPickerSearch, setUserPickerSearch] = createSignal("");
  const [agencyJumpMenu, setAgencyJumpMenu] = createSignal<string | null>(null);
  const agencyNameMap = createMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    agencies().forEach((agency) => {
      map[agency.code] = agency.name || "";
    });
    return map;
  });

  onMount(() => {
    let unsubscribe: (() => void) | undefined;

    onCleanup(() => {
      unsubscribe?.();
    });

    void (async () => {
      try {
        const { isAdmin } = await teamService.getCurrentUserAccessLevel();

        unsubscribe = teamService.subscribeToTeamData(
          (data) => {
            // Map users
            const mappedUsers = data.users.map((user) => ({
              id: user.id,
              nickname: user.nickname || "",
              fullName: user.fullName || "",
              email: isAdmin ? user.email : undefined,
              accessLevel: isAdmin ? user.accessLevel || "standard" : "standard",
              fscCode: user.fscCode || "",
              agencyCode: user.agencyCode || "",
              birthMonth: user.birthMonth,
              birthDay: user.birthDay,
              birthYear: user.birthYear,
              contractMonth: user.contractMonth,
              contractDay: user.contractDay,
              contractYear: user.contractYear,
            }));
            const sorted = mappedUsers.sort((a, b) =>
              (a.nickname || "").localeCompare(b.nickname || ""),
            );
            setUsers(sorted);

            // Preserve stored agency order
            setAgencies([...data.agencies]);

            setUsersLoading(false);
            setUsersError(null);
          },
          (error) => {
            setUsersError(error);
            setUsersLoading(false);
          },
        );
      } catch (error) {
        setUsersError(
          error instanceof Error
            ? new Error(
                getCaptchaAwareErrorMessage(
                  error,
                  "Unable to load users right now.",
                ),
              )
            : error,
        );
        setUsersLoading(false);
      }
    })();
  });

  const openReorderModal = () => {
    setReorderList(JSON.parse(JSON.stringify(agencies())));
    setReorderDirty(false);
    setShowReorderAgencies(true);
  };

  const closeReorderModal = () => {
    setShowReorderAgencies(false);
    setReorderList([]);
    setReorderDirty(false);
  };

  const moveAgency = (from: number, to: number) => {
    const newList = [...reorderList()];
    const [item] = newList.splice(from, 1);
    newList.splice(to, 0, item);
    setReorderList(newList);
    setReorderDirty(true);
  };

  const handleSaveReorder = async () => {
    if (!reorderDirty()) {
      setShowReorderAgencies(false);
      return;
    }
    setReorderSaving(true);
    try {
      await teamService.saveTeamData({
        users: users(),
        agencies: reorderList(),
      });
      setAgencies(reorderList());
      setShowReorderAgencies(false);
      setReorderDirty(false);
    } finally {
      setReorderSaving(false);
    }
  };

  const sortedAgenciesForPicker = createMemo(() => [...agencies()]);

  const filteredUsersForPicker = createMemo(() => {
    const term = userPickerSearch().trim().toLowerCase();
    return users().filter((user) => {
      if (!term) return true;
      const agencyCode = user.agencyCode || "Unassigned";
      return `${user.nickname || ""} ${user.fullName || ""} ${user.email || ""} ${
        user.fscCode || ""
      } ${agencyCode}`
        .toLowerCase()
        .includes(term);
    });
  });

  const groupedUsersForPicker = createMemo(() => {
    const groups = new Map<string, TeamUser[]>();
    filteredUsersForPicker().forEach((user) => {
      const key = user.agencyCode || "Unassigned";
      const existing = groups.get(key);
      if (existing) {
        existing.push(user);
      } else {
        groups.set(key, [user]);
      }
    });

    const agencyOrder = agencies().map((agency) => agency.code);
    const orderedKeys = [
      ...agencyOrder.filter((code) => groups.has(code)),
      ...Array.from(groups.keys()).filter(
        (code) => !agencyOrder.includes(code),
      ),
    ];

    return orderedKeys.map((agencyCode) => {
      const members = (groups.get(agencyCode) || []).sort((a, b) => {
        const aCode = String(a.fscCode || "");
        const bCode = String(b.fscCode || "");
        const codeCompare = aCode.localeCompare(bCode, undefined, {
          numeric: true,
        });
        if (codeCompare !== 0) return codeCompare;
        return String(a.nickname || "").localeCompare(String(b.nickname || ""));
      });
      return {
        agencyCode,
        members,
        agencyName: agencyNameMap()[agencyCode] || "",
      };
    });
  });

  const accessLabel = (value?: string) => {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized || normalized === "standard") return "Standard";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const highlightMatch = (text: string, query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return text;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);
    return parts.map((part) =>
      regex.test(part) ? (
        <span class="rounded bg-yellow-200 px-0 text-gray-900">{part}</span>
      ) : (
        part
      ),
    );
  };

  return (
    <PageShell>
      <Show when={!showUserForm()}>
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
      </Show>

      <PageBody><div class="space-y-4">
        <div class="w-full max-w-2xl space-y-3">
          <For each={manageTeamActionOptions}>
            {(option) => (
              <button
                type="button"
                onClick={() => {
                  if (option.action === "addUser") {
                    setAddUserRequested(true);
                    return;
                  }
                  if (option.action === "editUser") {
                    setShowUserPicker(true);
                    return;
                  }
                  if (option.action === "addAgency") {
                    setAddAgencyRequested(true);
                    return;
                  }
                  if (option.action === "editAgency") {
                    setShowAgencyPicker(true);
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

      <ManageUsers
        users={users()}
        usersLoading={usersLoading()}
        usersError={usersError()}
        agencies={agencies()}
        showForm={showUserForm}
        setShowForm={setShowUserForm}
        showList={false}
        addUserRequested={addUserRequested}
        setAddUserRequested={setAddUserRequested}
        editUser={editUserTarget}
        setEditUser={setEditUserTarget}
        deleteUser={deleteUserTarget}
        setDeleteUser={setDeleteUserTarget}
        onRefresh={() => {}}
      />

      <ManageAgencies
        agencies={agencies()}
        users={users()}
        showList={false}
        addAgencyRequested={addAgencyRequested}
        setAddAgencyRequested={setAddAgencyRequested}
        editAgency={editAgencyTarget}
        setEditAgency={setEditAgencyTarget}
        deleteAgency={deleteAgencyTarget}
        setDeleteAgency={setDeleteAgencyTarget}
        onRefetchAgencies={() => {}}
        onRefreshUsers={() => {}}
      />

      <Show when={showUserPicker()}>
        <EditModal
          title="Choose a user to edit"
          onClose={() => setShowUserPicker(false)}
          bodyClass="pb-6 pt-0"
        >
          <div>
            <div class="sticky top-0 z-20 bg-white pt-3 pb-3">
              <input
                type="search"
                value={userPickerSearch()}
                onInput={(e) => setUserPickerSearch(e.currentTarget.value)}
                placeholder="Search users..."
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
              />
            </div>

            <Show
              when={groupedUsersForPicker().length > 0}
              fallback={
                <div class="text-base text-gray-600">No users available.</div>
              }
            >
              <div class="space-y-4">
                <For each={groupedUsersForPicker()}>
                  {(group) => (
                    <div id={`user-picker-group-${group.agencyCode}`} style={{ "scroll-margin-top": "4.5rem" }}>
                      <div class="sticky top-[4rem] z-10 border-b border-gray-200 bg-admin-from/10 backdrop-blur">
                        <button
                          type="button"
                          class="flex w-full items-center justify-between px-3 py-2 text-left cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            document
                              .getElementById(
                                `user-picker-group-${group.agencyCode}`,
                              )
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            setAgencyJumpMenu(
                              agencyJumpMenu() === group.agencyCode
                                ? null
                                : group.agencyCode,
                            );
                          }}
                        >
                          <span class="text-base font-semibold text-gray-800">
                            {group.agencyName
                              ? `${group.agencyName} (${group.agencyCode})`
                              : group.agencyCode}
                          </span>
                          <TbOutlineChevronDown
                            class={`h-4 w-4 text-gray-500 transition-transform duration-200 ${
                              agencyJumpMenu() === group.agencyCode
                                ? "rotate-180"
                                : ""
                            }`}
                          />
                        </button>
                        <Show when={agencyJumpMenu() === group.agencyCode}>
                          <div class="border-t border-gray-200 bg-white py-1">
                            <For each={groupedUsersForPicker()}>
                              {(g) => (
                                <button
                                  type="button"
                                  class={`cursor-pointer w-full px-3 py-1.5 text-left text-base transition hover:bg-admin-from/5 ${
                                    g.agencyCode === group.agencyCode
                                      ? "font-semibold text-admin-from"
                                      : "text-gray-700"
                                  }`}
                                  onClick={() => {
                                    setAgencyJumpMenu(null);
                                    document
                                      .getElementById(
                                        `user-picker-group-${g.agencyCode}`,
                                      )
                                      ?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                      });
                                  }}
                                >
                                  {g.agencyName
                                    ? `${g.agencyName} (${g.agencyCode})`
                                    : g.agencyCode}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                      <div class="divide-y divide-gray-200">
                        <For each={group.members}>
                          {(user) => (
                            <div class="flex w-full items-center gap-3 bg-white px-3 py-2.5">
                              <div class="min-w-0 flex-1">
                                <div class="text-base font-semibold text-gray-900">
                                  {highlightMatch(
                                    user.nickname ||
                                      user.fullName ||
                                      user.email ||
                                      user.fscCode ||
                                      user.id,
                                    userPickerSearch(),
                                  )}
                                </div>
                                <Show when={user.fullName && user.nickname}>
                                  <div class="text-base text-gray-700">
                                    {highlightMatch(user.fullName!, userPickerSearch())}
                                  </div>
                                </Show>
                                <Show when={user.email}>
                                  <div class="text-base text-gray-600">
                                    {highlightMatch(user.email!, userPickerSearch())}
                                  </div>
                                </Show>
                                <div class="text-base text-gray-600">
                                  {highlightMatch(
                                    user.fscCode || "—",
                                    userPickerSearch(),
                                  )}{" "}
                                  · {accessLabel(user.accessLevel)}
                                </div>
                              </div>
                              <div class="flex items-center gap-2">
                                <IconButton
                                  type="button"
                                  variant="default"
                                  class="border border-gray-300 text-gray-600"
                                  aria-label="Edit user"
                                  onClick={() => {
                                    setShowUserPicker(false);
                                    setEditUserTarget(user);
                                  }}
                                >
                                  <TbOutlinePencil class="h-4 w-4" />
                                </IconButton>
                                <IconButton
                                  type="button"
                                  variant="default"
                                  class="border border-gray-300 text-red-600 hover:bg-red-50"
                                  aria-label="Delete user"
                                  onClick={() => {
                                    setDeleteUserTarget(user);
                                  }}
                                >
                                  <TbOutlineTrash class="h-4 w-4" />
                                </IconButton>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </EditModal>
      </Show>

      <Show when={showAgencyPicker()}>
        <EditModal
          title="Choose an agency to edit"
          onClose={() => setShowAgencyPicker(false)}
          bodyClass="pb-6 pt-4"
        >
          <Show
            when={agencies().length > 0}
            fallback={<div class="text-base text-gray-600">No agencies available.</div>}
          >
            <div class="space-y-2">
              <For each={sortedAgenciesForPicker()}>
                {(agency) => (
                  <div class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 transition hover:border-admin-from/40 hover:bg-admin-from/5">
                    <div class="min-w-0 flex-1 text-left">
                      <div class="font-semibold text-gray-900">{agency.name || "—"}</div>
                      <div class="text-sm text-gray-500">{agency.code}</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <IconButton
                        type="button"
                        variant="default"
                        onClick={() => {
                          setShowAgencyPicker(false);
                          setEditAgencyTarget(agency);
                        }}
                        class="border border-gray-300 text-gray-600"
                        aria-label="Edit agency"
                      >
                        <TbOutlinePencil class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="default"
                        onClick={() => {
                          setShowAgencyPicker(false);
                          setDeleteAgencyTarget(agency);
                        }}
                        class="border border-gray-300 text-red-600 hover:bg-red-50"
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
        </EditModal>
      </Show>

      <Show when={showReorderAgencies()}>
        <EditModal
          title="Reorder Agencies"
          onClose={closeReorderModal}
          onSave={handleSaveReorder}
          saving={() => reorderSaving()}
          saveDisabled={reorderSaving() || !reorderDirty()}
          hasUnsavedChanges={() => reorderDirty()}
          bodyClass="pb-6 pt-4"
        >
          <div class="pb-4 text-base text-gray-600">
            Change the order of agencies by moving items up or down.<br />
            <br />
            This affects how agencies are displayed in the closing submission form 
            (FSC #2 picker), as well as the Team Agency page.
          </div>
          <ReorderList
            items={reorderList()}
            itemKey={(agency) => agency.code}
            onMove={moveAgency}
            emptyMessage="No agencies to reorder."
            renderLabel={(agency) => (
              <div>
                <div class="font-semibold text-gray-900">{agency.code}</div>
                <div class="text-sm text-gray-500">{agency.name || "—"}</div>
              </div>
            )}
          />
        </EditModal>
      </Show>
      <BlockingOverlay
        open={reorderSaving()}
        title="Saving agency order..."
        message="Please wait while your request is being processed."
      />

    </PageShell>
  );
};

export default ManageTeam;
