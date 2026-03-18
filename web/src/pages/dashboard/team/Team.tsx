import {
  Component,
  For,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  createResource,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineCalendarEvent,
  TbOutlineBuilding,
  TbOutlineCake,
  TbOutlinePencil,
} from "solid-icons/tb";
import {
  AccordionCard,
  PageShell,
  PageHeader,
  PageBody,
  IconButton,
  BackToTopFab,
  LoadingState,
} from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";

import {
  teamService,
  isStaffUser,
  type TeamUser,
} from "../../../services/teamService";
import { getCaptchaAwareErrorMessage } from "../../../services/authService";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Module-level state
const [viewMode, setViewMode] = createSignal<"birthday" | "agency">("birthday");
const [openAgency, setOpenAgency] = createSignal<string | null>(null);
const [openMonth, setOpenMonth] = createSignal<number | null>(
  new Date().getMonth() + 1,
);
const [isAdmin, setIsAdmin] = createSignal(false);

// Helper functions
const formatBirthdate = (member: TeamUser) => {
  if (!member.birthMonth || !member.birthDay) return "Birthday not set";
  const month =
    monthNames[member.birthMonth - 1] || `Month ${member.birthMonth}`;
  const day = member.birthDay.toString().padStart(2, "0");
  return `${month} ${day}`;
};

const formatFscCode = (fscCode?: string | number) => {
  if (!fscCode) return "—";
  const fscStr = String(fscCode);
  if (fscStr.startsWith("00")) return "staff";
  return fscStr;
};

const isBirthdayToday = (member: TeamUser) => {
  const today = new Date();
  return (
    member.birthMonth === today.getMonth() + 1 &&
    member.birthDay === today.getDate()
  );
};

const agencySectionId = (code: string) =>
  `agency-${(code || "unassigned").replace(/\s+/g, "-")}`;
const monthSectionId = (month: number) => `month-${month}`;

const agencyLabel = (code: string, agencyNames: Record<string, string>) => {
  if (!code) return "Unassigned";
  const name = agencyNames[code];
  return name ? `${code} — ${name}` : code;
};

// Computed values (take members as parameter)
const groupedMembers = (members: TeamUser[]) => {
  const withBirth = members
    .filter((member) => member.birthMonth && member.birthDay)
    .sort((a, b) => {
      if (a.birthMonth === b.birthMonth) {
        return (a.birthDay || 0) - (b.birthDay || 0);
      }
      return (a.birthMonth || 0) - (b.birthMonth || 0);
    });

  const groups: { month: number; members: TeamUser[] }[] = [];
  for (let month = 1; month <= 12; month++) {
    const monthMembers = withBirth.filter((m) => m.birthMonth === month);
    if (monthMembers.length > 0) {
      groups.push({ month, members: monthMembers });
    }
  }
  return groups;
};

const groupedByAgency = (members: TeamUser[], agencyOrder: string[]) => {
  const safeString = (value: any) => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const list = [...members].sort((a, b) =>
    (a.nickname || "").localeCompare(b.nickname || "", undefined, {
      sensitivity: "base",
    }),
  );
  const map = new Map<
    string,
    { members: TeamUser[]; agentCount: number; staffCount: number }
  >();
  list.forEach((member) => {
    const key = member.agencyCode || "Unassigned";
    const entry = map.get(key) || { members: [], agentCount: 0, staffCount: 0 };
    const isStaff = isStaffUser(member.fscCode);
    entry.members.push(member);
    if (isStaff) {
      entry.staffCount += 1;
    } else {
      entry.agentCount += 1;
    }
    map.set(key, entry);
  });
  const orderedKeys = [
    ...agencyOrder.filter((code) => map.has(code)),
    ...Array.from(map.keys()).filter((code) => !agencyOrder.includes(code)),
  ];

  return orderedKeys.map((agency) => {
    const members = map.get(agency) || {
      members: [],
      agentCount: 0,
      staffCount: 0,
    };
    return {
      agency,
      members: [...members.members].sort((a, b) =>
        safeString(a.fscCode).localeCompare(safeString(b.fscCode), undefined, {
          sensitivity: "base",
        }),
      ),
      agentCount: members.agentCount,
      staffCount: members.staffCount,
    };
  });
};

const Team: Component = () => {
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = createSignal(false);
  const [members, setMembers] = createSignal<TeamUser[]>([]);
  const [membersLoading, setMembersLoading] = createSignal(true);
  const [membersError, setMembersError] = createSignal<unknown>(null);
  const [lastAnimatedViewMode, setLastAnimatedViewMode] = createSignal<
    "birthday" | "agency" | null
  >(null);
  let pendingScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAlignTimer: ReturnType<typeof setTimeout> | undefined;
  let contentRef: HTMLDivElement | undefined;

  const [agencyNames] = createResource(async () => {
    return teamService.getAgencyNames();
  });
  const [agencies] = createResource(() => teamService.getAgencies());

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await teamService.getUsers(true); // Force refresh
    } finally {
      setRefreshing(false);
    }
  };

  onMount(() => {
    const unsubscribe = teamService.subscribeUsers(
      (list) => {
        setMembers(list);
        setMembersLoading(false);
        setMembersError(null);
      },
      (error) => {
        setMembersError(error);
        setMembersLoading(false);
      },
    );
    onCleanup(unsubscribe);

    teamService
      .getCurrentUserAccessLevel()
      .then(({ isAdmin }) => setIsAdmin(isAdmin))
      .catch(() => setIsAdmin(false));
  });

  createEffect(() => {
    const mode = viewMode();
    const prev = lastAnimatedViewMode();
    if (prev === null) {
      setLastAnimatedViewMode(mode);
      return;
    }
    if (prev === mode || !contentRef) return;

    const direction = prev === "birthday" && mode === "agency" ? 1 : -1;
    contentRef.animate(
      [
        { transform: `translateX(${direction * 18}px)`, opacity: 0.82 },
        { transform: "translateX(0px)", opacity: 1 },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
    setLastAnimatedViewMode(mode);
  });

  const clearPendingTimers = () => {
    if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
    if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
    if (pendingAlignTimer) clearTimeout(pendingAlignTimer);
    pendingScrollTimer = undefined;
    pendingOpenTimer = undefined;
    pendingAlignTimer = undefined;
  };

  const scrollHeaderIntoView = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const stickyOffset = 48;
    const targetTop =
      target.getBoundingClientRect().top +
      (window.scrollY || window.pageYOffset || 0);
    const destination = Math.max(0, targetTop - stickyOffset);
    window.scrollTo({ top: destination, behavior: "smooth" });
  };

  const alignAfterExpand = (id: string) => {
    pendingAlignTimer = setTimeout(() => {
      scrollHeaderIntoView(id);
    }, 320);
  };

  const openMonthAndAlign = (month: number) => {
    setOpenMonth(month);
    alignAfterExpand(monthSectionId(month));
  };

  const openAgencyAndAlign = (code: string) => {
    setOpenAgency(code);
    alignAfterExpand(agencySectionId(code));
  };

  const toggleMonth = (month: number) => {
    clearPendingTimers();
    const current = openMonth();
    if (current === month) {
      setOpenMonth(null);
      return;
    }

    if (!current) {
      scrollHeaderIntoView(monthSectionId(month));
      openMonthAndAlign(month);
      return;
    }

    setOpenMonth(null);
    pendingScrollTimer = setTimeout(() => {
      scrollHeaderIntoView(monthSectionId(month));
      pendingOpenTimer = setTimeout(() => openMonthAndAlign(month), 220);
    }, 280);
  };

  const toggleAgency = (code: string) => {
    clearPendingTimers();
    const current = openAgency();
    if (current === code) {
      setOpenAgency(null);
      return;
    }

    if (!current) {
      scrollHeaderIntoView(agencySectionId(code));
      openAgencyAndAlign(code);
      return;
    }

    setOpenAgency(null);
    pendingScrollTimer = setTimeout(() => {
      scrollHeaderIntoView(agencySectionId(code));
      pendingOpenTimer = setTimeout(() => openAgencyAndAlign(code), 220);
    }, 280);
  };

  onCleanup(() => clearPendingTimers());

  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic component={dashboardOptions.team.icon} class="h-5 w-5" />
        }
        title={dashboardOptions.team.title}
        subtitle={dashboardOptions.team.description}
      />

      <PageBody>
        <div class="space-y-0 pb-10">
          <_ViewToggle />

          <Show
            when={!membersLoading()}
            fallback={
              <div class="py-4">
                <LoadingState label="Loading team members..." />
              </div>
            }
          >
            <Show
              when={!membersError()}
              fallback={
                <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700 shadow-sm">
                  {getCaptchaAwareErrorMessage(
                    membersError(),
                    "Unable to load team members right now.",
                  )}
                </div>
              }
            >
              <Show
                when={members().length > 0}
                fallback={
                  <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <p class="text-base text-gray-600">
                      {viewMode() === "birthday"
                        ? "No birthdays to show yet."
                        : "No team members to show yet."}
                    </p>
                  </div>
                }
              >
                <div ref={contentRef}>
                  <Show
                    when={viewMode() === "birthday"}
                    fallback={
                      <_AgencyView
                        members={members() ?? []}
                        agencyNames={agencyNames() ?? {}}
                        agencyOrder={(agencies() || []).map((agency) => agency.code)}
                        openAgency={openAgency()}
                        onToggleAgency={toggleAgency}
                      />
                    }
                  >
                    <_BirthdayView
                      members={members() ?? []}
                      openMonth={openMonth()}
                      onToggleMonth={toggleMonth}
                    />
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </PageBody>

      <BackToTopFab />
    </PageShell>
  );
};

/*******************************
 *
 * BEGIN all subcomponents below
 *
 *******************************/

const _ViewToggle: Component = () => {
  const [indicatorStyle, setIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });
  let tabsRef: HTMLDivElement | undefined;
  let birthdayRef: HTMLButtonElement | undefined;
  let agencyRef: HTMLButtonElement | undefined;

  const updateIndicator = () => {
    if (!tabsRef) return;
    const active = viewMode() === "birthday" ? birthdayRef : agencyRef;
    if (!active) return;
    const parentRect = tabsRef.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setIndicatorStyle({
      left: activeRect.left - parentRect.left,
      width: activeRect.width,
    });
  };

  createEffect(() => {
    viewMode();
    requestAnimationFrame(updateIndicator);
  });

  onMount(() => {
    requestAnimationFrame(updateIndicator);
    window.addEventListener("resize", updateIndicator);
  });

  onCleanup(() => {
    window.removeEventListener("resize", updateIndicator);
  });

  return (
    <div class="sticky top-0 z-30 -mx-4 bg-gray-50/95 px-4 pt-2 backdrop-blur-sm">
      <div ref={tabsRef} class="relative flex mb-4 border-b border-primary-100">
        <button
          ref={birthdayRef}
          type="button"
          class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-base font-semibold transition ${
            viewMode() === "birthday"
              ? "text-primary"
              : "cursor-pointer text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setViewMode("birthday")}
        >
          <TbOutlineCake class="h-4 w-4" />
          Birthdays
        </button>
        <button
          ref={agencyRef}
          type="button"
          class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-base font-semibold transition ${
            viewMode() === "agency"
              ? "text-primary"
              : "cursor-pointer text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setViewMode("agency")}
        >
          <TbOutlineBuilding class="h-4 w-4" />
          Agencies
        </button>
        <span
          class="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-250 ease-out"
          style={{
            left: `${indicatorStyle().left}px`,
            width: `${indicatorStyle().width}px`,
          }}
        />
      </div>
    </div>
  );
};

const _BirthdayView: Component<{
  members: TeamUser[];
  openMonth: number | null;
  onToggleMonth: (month: number) => void;
}> = (props) => {
  const currentMonth = new Date().getMonth() + 1;

  return (
    <div class="space-y-3">
      <For each={groupedMembers(props.members)}>
        {(group) => (
          <AccordionCard
            id={monthSectionId(group.month)}
            open={props.openMonth === group.month}
            stickyClass="sticky top-11 z-20"
            onToggle={() => props.onToggleMonth(group.month)}
            gradientClass={
              group.month === currentMonth
                ? "bg-linear-to-b from-pink-500 to-purple-500"
                : undefined
            }
            headerBgClass={
              group.month === currentMonth
                ? "bg-linear-to-r from-pink-50/95 via-purple-50/95 to-blue-50/95 hover:from-pink-100 hover:via-purple-100 hover:to-blue-100"
                : undefined
            }
            header={
              <div class="flex items-center gap-2">
                <TbOutlineCalendarEvent
                  class={`h-4 w-4 ${group.month === currentMonth ? "text-purple-600" : "text-primary"}`}
                />
                <div class="flex-1 text-base font-semibold text-gray-900">
                  {group.month === currentMonth && <span class="mr-1.5">🎉</span>}
                  {monthNames[group.month - 1]}
                  {group.month === currentMonth && (
                    <span class="ml-2 inline-flex items-center rounded-full bg-gradient-to-r from-pink-500 to-purple-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow-sm">
                      This Month
                    </span>
                  )}
                </div>
                <div class="text-sm text-gray-500">
                  {group.members.length}{" "}
                  {group.members.length === 1 ? "member" : "members"}
                </div>
              </div>
            }
          >
            <div class="divide-y divide-gray-100">
              <For each={group.members}>
                {(member) => {
                  const isToday = isBirthdayToday(member);
                  return (
                    <div
                      class={`flex items-center justify-between px-4 py-3 transition-colors ${
                        isToday
                          ? "bg-linear-to-r from-pink-50 via-yellow-50 to-purple-50 hover:from-pink-100 hover:via-yellow-100 hover:to-purple-100"
                          : "hover:bg-gray-50/80"
                      }`}
                    >
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <p
                            class={`text-base font-semibold ${isToday ? "text-purple-900" : "text-gray-900"}`}
                          >
                            {member.nickname}
                          </p>
                          <Show when={isToday}>
                            <span class="inline-flex items-center rounded-full bg-linear-to-r from-pink-500 via-yellow-400 to-purple-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow-sm animate-pulse">
                              🎂 Today!
                            </span>
                          </Show>
                        </div>
                        <div class="flex items-center gap-1.5 text-sm text-gray-600">
                          <TbOutlineCake
                            class={`h-3 w-3 shrink-0 align-baseline ${isToday ? "text-pink-500" : ""}`}
                          />
                          <span
                            class={
                              isToday ? "font-semibold text-purple-700" : ""
                            }
                          >
                            {formatBirthdate(member)}
                          </span>
                        </div>
                      </div>
                      <div class="text-sm text-gray-600">
                        {member.agencyCode || "—"} /{" "}
                        {formatFscCode(member.fscCode)}
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </AccordionCard>
        )}
      </For>
    </div>
  );
};

const _AgencyView: Component<{
  members: TeamUser[];
  agencyNames: Record<string, string>;
  agencyOrder: string[];
  openAgency: string | null;
  onToggleAgency: (agency: string) => void;
}> = (props) => {
  return (
    <div class="space-y-3">
      <For each={groupedByAgency(props.members, props.agencyOrder)}>
        {(group) => (
          <AccordionCard
            id={agencySectionId(group.agency)}
            open={props.openAgency === group.agency}
            stickyClass="sticky top-11 z-20"
            onToggle={() => props.onToggleAgency(group.agency)}
            header={
              <div class="flex items-center gap-2">
                <TbOutlineBuilding class="h-4 w-4 text-primary" />
                <div class="flex-1 text-base font-semibold text-gray-900">
                  {agencyLabel(group.agency, props.agencyNames)}
                </div>
                <div class="text-sm text-gray-500">
                  {group.agentCount} {group.agentCount === 1 ? "Agent" : "Agents"}
                  {group.staffCount > 0
                    ? `, ${group.staffCount} ${group.staffCount === 1 ? "Staff" : "Staff"}`
                    : ""}
                </div>
              </div>
            }
          >
            <div class="divide-y divide-gray-100">
              <For each={group.members}>
                {(member) => (
                  <div class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50/80">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-base font-semibold text-gray-900">
                          {member.nickname}
                        </p>
                        <Show
                          when={String(member.fscCode || "").startsWith("00")}
                        >
                          <span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                            Staff
                          </span>
                        </Show>
                      </div>
                      <div class="flex items-center gap-1.5 text-sm text-gray-600">
                        <TbOutlineCake class="h3 w-3 shrink-0" />
                        <span>{formatBirthdate(member)}</span>
                      </div>
                    </div>
                    <div class="text-sm text-gray-600">
                      {member.agencyCode || "—"} /{" "}
                      {formatFscCode(member.fscCode)}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </AccordionCard>
        )}
      </For>
    </div>
  );
};

export default Team;
