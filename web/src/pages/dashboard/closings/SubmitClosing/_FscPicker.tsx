import {
  Component,
  createEffect,
  createSignal,
  createMemo,
  createResource,
  For,
  Show,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import {
  TbOutlineSearch,
  TbOutlineBuilding,
  TbOutlineCheck,
} from "solid-icons/tb";
import { teamService, type TeamUser } from "../../../../services/teamService";
import { EditModal, Spinner } from "../../../../components/ui";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: {
    fscCode: string;
    nickname: string;
    isNone?: boolean;
  }) => void;
  excludeFscCode?: string; // Current user's FSC code to exclude
  includeNone?: boolean;
  includeOther?: boolean;
  selectedFscCode?: string;
  selectedNickname?: string;
  selectedNone?: boolean;
};

const _FscPicker: Component<Props> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("");
  const [users, setUsers] = createSignal<TeamUser[]>([]);
  const [usersLoading, setUsersLoading] = createSignal(true);
  const [usersError, setUsersError] = createSignal<unknown>(null);
  let searchInputRef: HTMLInputElement | undefined;

  const [agencyNames] = createResource(() => teamService.getAgencyNames());
  const [agencies] = createResource(() => teamService.getAgencies());

  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightMatch = (text: string): JSX.Element => {
    const query = searchTerm().trim();
    if (!query) return text;
    const regex = new RegExp(`(${escapeRegExp(query)})`, "ig");
    const parts = text.split(regex);
    return (
      <>
        <For each={parts}>
          {(part) =>
            part.toLowerCase() === query.toLowerCase() ? (
              <mark class="rounded bg-yellow-200/90 px-0.5 text-inherit">
                {part}
              </mark>
            ) : (
              part
            )
          }
        </For>
      </>
    );
  };

  const groupedUsers = createMemo(() => {
    let list = users();

    // Exclude staff (FSC starting with 00)
    list = list.filter((u) => !(u.fscCode || "").startsWith("00"));

    // Exclude current user
    if (props.excludeFscCode) {
      list = list.filter((u) => u.fscCode !== props.excludeFscCode);
    }

    // Filter by search term
    const query = searchTerm().toLowerCase().trim();
    if (query) {
      list = list.filter(
        (u) => {
          const agencyCode = u.agencyCode || "Unassigned";
          const agencyName = agencyNames()?.[agencyCode] || "";
          return (
            (u.nickname || "").toLowerCase().includes(query) ||
            (u.fscCode || "").toLowerCase().includes(query) ||
            (u.fullName || "").toLowerCase().includes(query) ||
            agencyCode.toLowerCase().includes(query) ||
            agencyName.toLowerCase().includes(query)
          );
        },
      );
    }

    const groups = new Map<string, TeamUser[]>();
    list.forEach((user) => {
      const key = user.agencyCode || "Unassigned";
      const existing = groups.get(key);
      if (existing) {
        existing.push(user);
      } else {
        groups.set(key, [user]);
      }
    });

    const agencyOrder = (agencies() || []).map((agency) => agency.code);
    const orderedKeys = [
      ...agencyOrder.filter((code) => groups.has(code)),
      ...Array.from(groups.keys()).filter(
        (code) => !agencyOrder.includes(code),
      ),
    ];

    return orderedKeys.map((agency) => {
      const members = (groups.get(agency) || []).sort((a, b) => {
        const fscA = a.fscCode || "";
        const fscB = b.fscCode || "";
        return fscA.localeCompare(fscB, undefined, { numeric: true });
      });
      return {
        agency,
        agencyName: agencyNames()?.[agency] || "",
        members,
      };
    });
  });

  const resultsChangeKey = createMemo(() =>
    groupedUsers()
      .map(
        (group) =>
          `${group.agency}:${group.members
            .map((member) => `${member.fscCode || ""}|${member.nickname || ""}`)
            .join(",")}`,
      )
      .join("||"),
  );

  createEffect(() => {
    if (!props.isOpen) return;
    resultsChangeKey();
    requestAnimationFrame(() => {
      const scrollRoot = searchInputRef?.closest(
        "[data-scroll-lock-allow-touch='true']",
      ) as HTMLElement | null;
      if (scrollRoot) {
        scrollRoot.scrollTo({ top: 0, behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    });
  });

  const isUserSelected = (user: TeamUser) => {
    const userCode = user.fscCode || "";
    const selectedCode = props.selectedFscCode || "";
    if (userCode && selectedCode) return userCode === selectedCode;
    if (userCode || selectedCode) return false;
    return (user.nickname || "") === (props.selectedNickname || "");
  };

  const isNoneSelected = () => props.selectedNone === true;
  const isOtherSelected = () =>
    !props.selectedNone &&
    !(props.selectedFscCode || "") &&
    (props.selectedNickname || "") === "Other - Not in list";

  const handleSelect = (user: TeamUser) => {
    props.onSelect({
      fscCode: user.fscCode || "",
      nickname: user.nickname || "",
    });
    handleClose();
  };

  const handleSelectNone = () => {
    props.onSelect({ fscCode: "", nickname: "", isNone: true });
    handleClose();
  };

  const handleSelectOther = () => {
    props.onSelect({ fscCode: "", nickname: "Other - Not in list" });
    handleClose();
  };

  const handleClose = () => {
    props.onClose();
  };

  onMount(() => {
    const unsubscribe = teamService.subscribeUsers(
      (list) => {
        setUsers(list);
        setUsersLoading(false);
        setUsersError(null);
      },
      (error) => {
        setUsersError(error);
        setUsersLoading(false);
      },
    );

    onCleanup(unsubscribe);
  });

  return (
    <Show when={props.isOpen}>
      <EditModal
        title="Select Team Member"
        onClose={handleClose}
        manageHistoryEntry
        bodyClass="pb-6 pt-0 px-4"
      >
          {/* Sticky search bar */}
          <div class="sticky top-0 z-20 -mx-4 bg-gray-50 px-4 py-3">
            <div class="rounded-lg border border-primary">
              <label class="relative block">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-primary">
                  <TbOutlineSearch class="h-4 w-4" />
                </span>
                <input
                  type="search"
                  ref={searchInputRef}
                  placeholder="Search consultant..."
                  value={searchTerm()}
                  onInput={(e) => setSearchTerm(e.currentTarget.value)}
                  class="w-full rounded-lg pt-3 pb-3 pl-9 pr-4 text-base focus:outline-none focus:ring-0 border-primary/30 bg-white/95 text-gray-800 placeholder:text-gray-400"
                />
              </label>
            </div>
          </div>

          <Show
            when={!usersLoading()}
            fallback={
              <div class="flex items-center justify-center py-8">
                <Spinner class="h-8 w-8 text-primary" />
              </div>
            }
          >
            <Show when={usersError()}>
              <div class="py-8 text-center text-base text-gray-500">
                Unable to load team members right now
              </div>
            </Show>
            <div class="space-y-6">
              <Show when={props.includeNone}>
                <section>
                  <div class="rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={handleSelectNone}
                      class={`flex w-full items-center gap-3 rounded-lg border-l-4 border-l-primary border-y border-r border-gray-200 px-4 py-3 text-left text-base transition-colors ${
                        isNoneSelected()
                          ? "bg-primary/5 font-semibold text-primary"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span class="min-w-0 flex-1">
                        Not shared
                      </span>
                      <Show when={isNoneSelected()}>
                        <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                      </Show>
                    </button>
                  </div>
                </section>
              </Show>

              <Show
                when={groupedUsers().length > 0}
                fallback={
                  <div class="py-8 text-center text-base text-gray-500">
                    No team members found
                  </div>
                }
              >
                <For each={groupedUsers()}>
                  {(group) => (
                    <section>
                      <div class="sticky top-[72px] z-10 -mx-4 mb-2 flex items-center gap-3 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
                        <div class="flex items-center gap-2">
                          <div class="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                            <TbOutlineBuilding class="h-3.5 w-3.5 text-primary" />
                          </div>
                          <h3 class="text-lg font-semibold text-gray-950">
                            {highlightMatch(group.agency)}
                            <Show when={group.agencyName}>
                              <> — {highlightMatch(group.agencyName)}</>
                            </Show>
                          </h3>
                          <span class="text-base text-gray-500">
                            ({group.members.length})
                          </span>
                        </div>
                        <div class="h-px flex-1 bg-gray-200" />
                      </div>
                      <div class="space-y-4">
                        <For each={group.members}>
                          {(user) => (
                            <div class="rounded-lg shadow-sm">
                              <button
                                type="button"
                                onClick={() => handleSelect(user)}
                                class={`flex w-full items-center gap-3 rounded-lg border-l-4 border-l-primary border-y border-r border-gray-200 px-4 py-3 text-left text-base transition-colors ${
                                  isUserSelected(user)
                                    ? "bg-primary/5 font-semibold text-primary"
                                    : "bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                <div class="min-w-0 flex-1">
                                  <div>
                                    {highlightMatch(user.nickname || "Unnamed")}
                                    <Show when={user.fscCode}>
                                      <span class="ml-1 text-base text-current/80">
                                        ({highlightMatch(user.fscCode || "")})
                                      </span>
                                    </Show>
                                  </div>
                                  <Show when={user.fullName}>
                                    <div class="text-base text-current/80">
                                      {highlightMatch(user.fullName || "")}
                                    </div>
                                  </Show>
                                </div>
                                <Show when={isUserSelected(user)}>
                                  <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                                </Show>
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </Show>

              <Show when={props.includeOther}>
                <section>
                  <div class="rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={handleSelectOther}
                      class={`flex w-full items-center gap-3 rounded-lg border-l-4 border-l-primary border-y border-r border-gray-200 px-4 py-3 text-left text-base transition-colors ${
                        isOtherSelected()
                          ? "bg-primary/5 font-semibold text-primary"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span class="min-w-0 flex-1">
                        Other - Not in list
                      </span>
                      <Show when={isOtherSelected()}>
                        <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                      </Show>
                    </button>
                  </div>
                </section>
              </Show>
            </div>
          </Show>
      </EditModal>
    </Show>
  );
};

export default _FscPicker;
