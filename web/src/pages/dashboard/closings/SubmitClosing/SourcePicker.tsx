import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  createResource,
  For,
  Show,
  onCleanup,
  type JSX,
} from "solid-js";
import { TbOutlineCheck, TbOutlineSearch } from "solid-icons/tb";
import {
  sourcesService,
  type Source,
} from "../../../../services/sourcesService";
import { AccordionCard, EditModal, Spinner } from "../../../../components/ui";

export type SourceSelection = {
  sourceId: string;
  sourceLabel: string;
  sourceItemId?: string;
  sourceItemLabel?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: SourceSelection) => void;
  selectedSourceId?: string;
  selectedSourceItemId?: string;
};

const sourceSectionId = (sourceId: string) =>
  `source-${String(sourceId || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

const sanitizeIdPart = (value: string) =>
  String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");

const sourceChildItemId = (sourceId: string, childId: string) =>
  `source-child-${sanitizeIdPart(sourceId)}-${sanitizeIdPart(childId)}`;

const sourceParentOnlyItemId = (sourceId: string) =>
  `source-parent-only-${sanitizeIdPart(sourceId)}`;

const STICKY_SEARCH_OFFSET_PX = 72;
const SOURCE_EXPAND_SCROLL_DELAY_MS = 360;
const SOURCE_HEADER_STICKY_TOP_PX = STICKY_SEARCH_OFFSET_PX + 6;
const SOURCE_HEADER_STICKY_CLASS = `sticky top-[${SOURCE_HEADER_STICKY_TOP_PX}px] z-10`;

type FilteredSource = {
  source: Source;
  visibleChildren: Source["children"];
  sourceMatches: boolean;
};

const SourcePicker: Component<Props> = (props) => {
  const [expandedSource, setExpandedSource] = createSignal<string | null>(null);
  const [searchTerm, setSearchTerm] = createSignal("");
  const [didInitialPositioning, setDidInitialPositioning] = createSignal(false);
  const [sources] = createResource(() => sourcesService.getSources());
  let searchInputRef: HTMLInputElement | undefined;
  let pendingScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAlignTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingInitialPositionTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingTimers = () => {
    if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
    if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
    if (pendingAlignTimer) clearTimeout(pendingAlignTimer);
    if (pendingInitialPositionTimer) clearTimeout(pendingInitialPositionTimer);
    pendingScrollTimer = undefined;
    pendingOpenTimer = undefined;
    pendingAlignTimer = undefined;
    pendingInitialPositionTimer = undefined;
  };

  const scrollElementIntoView = (
    id: string,
    behavior: ScrollBehavior = "smooth",
    stickyOffset = STICKY_SEARCH_OFFSET_PX,
  ): boolean => {
    const target = document.getElementById(id);
    if (!target) return false;

    const scrollContainer = target.closest(
      "[data-scroll-lock-allow-touch]",
    ) as HTMLElement | null;

    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const destination =
        scrollContainer.scrollTop + targetRect.top - containerRect.top - stickyOffset;
      scrollContainer.scrollTo({
        top: Math.max(0, destination),
        behavior,
      });
      return true;
    }

    const targetTop =
      target.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    window.scrollTo({
      top: Math.max(0, targetTop - stickyOffset),
      behavior,
    });
    return true;
  };

  const scrollHeaderIntoView = (id: string) => {
    scrollElementIntoView(id, "smooth", SOURCE_HEADER_STICKY_TOP_PX);
  };

  const getSourceContentOffset = (sourceId: string) => {
    const section = document.getElementById(sourceSectionId(sourceId));
    const headerButton = section?.querySelector("button");
    const headerHeight = headerButton instanceof HTMLElement ? headerButton.offsetHeight : 0;
    return SOURCE_HEADER_STICKY_TOP_PX + headerHeight;
  };

  const scrollSelectedItemIntoView = (source: Source) => {
    const hasChildren = source.children.length > 0;
    if (!hasChildren) {
      scrollElementIntoView(sourceSectionId(source.id), "auto");
      return;
    }

    const selectedSourceItemId = props.selectedSourceItemId || "";
    const targetId = selectedSourceItemId
      ? sourceChildItemId(source.id, selectedSourceItemId)
      : sourceParentOnlyItemId(source.id);
    const fallbackId = sourceSectionId(source.id);
    const stickyOffset = getSourceContentOffset(source.id);

    const tryScroll = (attempt: number) => {
      if (scrollElementIntoView(targetId, "auto", stickyOffset)) return;
      if (attempt >= 6) {
        scrollElementIntoView(fallbackId, "auto");
        return;
      }
      pendingInitialPositionTimer = setTimeout(() => {
        tryScroll(attempt + 1);
      }, 80);
    };

    tryScroll(0);
  };

  const alignAfterExpand = (id: string) => {
    pendingAlignTimer = setTimeout(() => {
      scrollHeaderIntoView(id);
    }, 320);
  };

  const openSourceAndAlign = (sourceId: string) => {
    setExpandedSource(sourceId);
    alignAfterExpand(sourceSectionId(sourceId));
  };

  const toggleSource = (sourceId: string) => {
    clearPendingTimers();
    const current = expandedSource();
    const sectionId = sourceSectionId(sourceId);
    if (current === sourceId) {
      setExpandedSource(null);
      return;
    }

    if (!current) {
      scrollHeaderIntoView(sectionId);
      openSourceAndAlign(sourceId);
      return;
    }

    setExpandedSource(null);
    pendingScrollTimer = setTimeout(() => {
      scrollHeaderIntoView(sectionId);
      pendingOpenTimer = setTimeout(() => {
        openSourceAndAlign(sourceId);
      }, 220);
    }, 280);
  };

  const handleSelectSource = (source: Source) => {
    if (source.children.length > 0) {
      toggleSource(source.id);
      return;
    }

    clearPendingTimers();
    props.onSelect({
      sourceId: source.id,
      sourceLabel: source.label,
    });
    props.onClose();
  };

  const handleSelectChild = (source: Source, child: Source["children"][number]) => {
    clearPendingTimers();
    props.onSelect({
      sourceId: source.id,
      sourceLabel: source.label,
      sourceItemId: child.id,
      sourceItemLabel: child.label,
    });
    props.onClose();
  };

  const handleSelectParentOnly = (source: Source) => {
    clearPendingTimers();
    props.onSelect({
      sourceId: source.id,
      sourceLabel: source.label,
    });
    props.onClose();
  };

  const hasSearchQuery = () => searchTerm().trim().length > 0;
  const normalizedSearch = createMemo(() => searchTerm().trim().toLowerCase());

  const filteredSources = createMemo<FilteredSource[]>(() => {
    const query = normalizedSearch();
    const sourceList = sources() ?? [];

    if (!query) {
      return sourceList.map((source) => ({
        source,
        visibleChildren: source.children,
        sourceMatches: true,
      }));
    }

    return sourceList
      .map((source) => {
        const sourceMatches =
          source.label.toLowerCase().includes(query) ||
          (source.description || "").toLowerCase().includes(query);
        const matchingChildren = source.children.filter((child) =>
          child.label.toLowerCase().includes(query),
        );

        if (!sourceMatches && matchingChildren.length === 0) return null;

        return {
          source,
          visibleChildren: sourceMatches ? source.children : matchingChildren,
          sourceMatches,
        };
      })
      .filter((entry): entry is FilteredSource => entry !== null);
  });

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

  createEffect(() => {
    if (!props.isOpen) {
      clearPendingTimers();
      setSearchTerm("");
      setExpandedSource(null);
      setDidInitialPositioning(false);
    }
  });

  createEffect(() => {
    if (!props.isOpen) return;
    const query = normalizedSearch();
    if (!query) return;
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

  createEffect(() => {
    if (!props.isOpen || didInitialPositioning() || sources.loading) return;

    const selectedSourceId = props.selectedSourceId || "";
    const sourceList = sources() ?? [];
    if (!selectedSourceId || sourceList.length === 0) {
      setDidInitialPositioning(true);
      return;
    }

    const selectedSource = sourceList.find((source) => source.id === selectedSourceId);
    setDidInitialPositioning(true);
    if (!selectedSource) return;

    if (selectedSource.children.length > 0) {
      setExpandedSource(selectedSource.id);
      pendingInitialPositionTimer = setTimeout(() => {
        scrollSelectedItemIntoView(selectedSource);
      }, SOURCE_EXPAND_SCROLL_DELAY_MS);
      return;
    }

    pendingInitialPositionTimer = setTimeout(() => {
      scrollElementIntoView(sourceSectionId(selectedSource.id), "auto");
    }, 0);
  });

  onCleanup(() => clearPendingTimers());

  return (
    <Show when={props.isOpen}>
      <EditModal
        title="Select Source"
        onClose={props.onClose}
        manageHistoryEntry
        bodyClass="pb-6 pt-0 px-4"
      >
        <Show
          when={!sources.loading}
          fallback={
            <div class="flex items-center justify-center py-8">
              <Spinner class="h-8 w-8 text-primary" />
            </div>
          }
        >
          <Show
            when={(sources() ?? []).length > 0}
            fallback={
              <div class="py-8 text-center text-lg text-gray-600">
                No sources configured
              </div>
            }
          >
            <>
              <div class="sticky top-0 z-20 -mx-4 bg-gray-50 px-4 py-3">
                <div class="rounded-lg border border-primary">
                  <label class="relative block">
                    <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-primary">
                      <TbOutlineSearch class="h-4 w-4" />
                    </span>
                    <input
                      type="search"
                      ref={searchInputRef}
                      placeholder="Search source..."
                      value={searchTerm()}
                      onInput={(e) => setSearchTerm(e.currentTarget.value)}
                      class="w-full rounded-lg border-primary/30 bg-white/95 pt-3 pb-3 pl-9 pr-4 text-base text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    />
                  </label>
                </div>
              </div>

              <Show
                when={filteredSources().length > 0}
                fallback={
                  <div class="py-8 text-center text-base text-gray-500">
                    No sources found
                  </div>
                }
              >
                <div class="space-y-4">
                  <For each={filteredSources()}>
                    {(entry) => {
                      const source = entry.source;
                      const hasChildren = source.children.length > 0;
                      const hasVisibleChildren = () => entry.visibleChildren.length > 0;
                      const isExpanded = () =>
                        hasChildren &&
                        (hasSearchQuery() || expandedSource() === source.id);
                      const isSourceSelected = () =>
                        props.selectedSourceId === source.id;
                      const isParentOnlySelected = () =>
                        isSourceSelected() && !props.selectedSourceItemId;
                      const showParentOnlyAction = () =>
                        !hasSearchQuery() || entry.sourceMatches;
                      const handleToggle = () => {
                        if (hasSearchQuery() && hasChildren) return;
                        handleSelectSource(source);
                      };

                      return (
                        <AccordionCard
                          id={sourceSectionId(source.id)}
                          class="shadow-sm"
                          open={isExpanded()}
                          onToggle={handleToggle}
                          showChevron={hasChildren && !hasSearchQuery()}
                          stickyClass={SOURCE_HEADER_STICKY_CLASS}
                          headerBgClass={
                            isSourceSelected()
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "bg-white hover:bg-gray-50"
                          }
                          header={
                            <div class="flex items-center gap-3">
                              <div class="min-w-0 flex-1">
                                <div
                                  class={`text-base font-semibold ${
                                    isSourceSelected() ? "text-primary" : "text-gray-900"
                                  }`}
                                >
                                  {highlightMatch(source.label)}
                                </div>
                                <Show when={source.description}>
                                  <div
                                    class={`text-base ${
                                      isSourceSelected()
                                        ? "text-primary/80"
                                        : "text-gray-600"
                                    }`}
                                  >
                                    {highlightMatch(source.description || "")}
                                  </div>
                                </Show>
                              </div>
                              <Show when={isParentOnlySelected()}>
                                <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                              </Show>
                            </div>
                          }
                        >
                          <Show when={hasChildren && hasVisibleChildren()}>
                            <div class="divide-y divide-gray-100">
                              <For each={entry.visibleChildren}>
                                {(child) => (
                                  <button
                                    type="button"
                                    id={sourceChildItemId(source.id, child.id)}
                                    onClick={() => handleSelectChild(source, child)}
                                    class={`flex w-full items-center px-4 py-3 text-left text-base transition-colors ${
                                      isSourceSelected() &&
                                      props.selectedSourceItemId === child.id
                                        ? "bg-primary/5 font-semibold text-primary"
                                        : "font-medium text-gray-700 hover:bg-gray-50/80"
                                    }`}
                                  >
                                    <span class="flex-1">{highlightMatch(child.label)}</span>
                                    <Show
                                      when={
                                        isSourceSelected() &&
                                        props.selectedSourceItemId === child.id
                                      }
                                    >
                                      <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                                    </Show>
                                  </button>
                                )}
                              </For>
                              <Show when={showParentOnlyAction()}>
                                <button
                                  type="button"
                                  id={sourceParentOnlyItemId(source.id)}
                                  onClick={() => handleSelectParentOnly(source)}
                                  class={`flex w-full items-center px-4 py-3 text-left text-base transition-colors ${
                                    isParentOnlySelected()
                                      ? "bg-primary/5 font-semibold text-primary"
                                      : "font-medium text-gray-700 hover:bg-gray-50/80"
                                  }`}
                                >
                                  <span class="flex-1">Other / not listed</span>
                                  <Show when={isParentOnlySelected()}>
                                    <TbOutlineCheck class="h-5 w-5 shrink-0 text-primary" />
                                  </Show>
                                </button>
                              </Show>
                            </div>
                          </Show>
                        </AccordionCard>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </>
          </Show>
        </Show>
      </EditModal>
    </Show>
  );
};

export default SourcePicker;
