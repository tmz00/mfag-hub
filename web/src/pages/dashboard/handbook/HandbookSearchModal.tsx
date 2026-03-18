import { A } from "@solidjs/router";
import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { TbOutlineArrowLeft } from "solid-icons/tb";
import { IconButton, LoadingState } from "../../../components/ui";
import { getCaptchaAwareErrorMessage } from "../../../services/authService";
import { getHandbookEntries } from "../../../services/handbookContentService";

type HandbookEntry = {
  id: string;
  category?: string;
  content?: string;
};

type SearchResult = {
  id: string;
  category: string;
  h2: string;
  section: string;
  lines: string[];
  targetText: string;
  targetKind: "line" | "section" | "category";
};

type Props = {
  isOpen?: boolean;
  onClose: () => void;
  closeOnResultClick?: boolean;
  renderAsPage?: boolean;
  initialCategory?: string;
  replaceResultNavigation?: boolean;
};

const DASHBOARD_HANDBOOK_RECENT_SEARCHES_KEY =
  "dashboard_handbook_recent_searches";
const MAX_RECENT_SEARCHES = 8;
const MAX_AUTOFOCUS_ATTEMPTS = 8;

const HandbookSearchModal: Component<Props> = (props) => {
  const isOpen = () => props.isOpen ?? true;
  const [handbookEntries, setHandbookEntries] = createSignal<HandbookEntry[]>([]);
  const [searchLoaded, setSearchLoaded] = createSignal(false);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal(
    (props.initialCategory || "").trim(),
  );
  const [recentSearches, setRecentSearches] = createSignal<string[]>([]);
  const [searchInputFocused, setSearchInputFocused] = createSignal(false);
  let searchInputRef: HTMLInputElement | undefined;
  let autofocusRetryTimerId: number | undefined;
  let closeInProgress = false;
  let closeResetTimerId: number | undefined;

  const loadSearchIndex = async () => {
    if (searchLoaded() || searchLoading()) return;
    try {
      setSearchLoading(true);
      setSearchError("");
      const parsed = await getHandbookEntries();
      if (!Array.isArray(parsed)) {
        setHandbookEntries([]);
        setSearchLoaded(true);
        return;
      }
      setHandbookEntries(
        parsed.map((entry: any, index: number) => ({
          id: String(index),
          category: entry?.category || "",
          content: entry?.content || "",
        })),
      );
      setSearchLoaded(true);
    } catch (error) {
      console.error("Failed to load handbook search index", error);
      setSearchError(
        getCaptchaAwareErrorMessage(
          error,
          "Unable to load handbook search right now.",
        ),
      );
    } finally {
      setSearchLoading(false);
    }
  };

  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const extractContentLines = (html: string) => {
    if (typeof window === "undefined" || !html) return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    let currentSection = "";
    let currentH2 = "";
    const lines: {
      section: string;
      h2: string;
      text: string;
      kind: "line" | "section" | "h2";
      isSection?: boolean;
    }[] = [];

    const pushLine = (
      text: string,
      isSection = false,
      kind: "line" | "section" | "h2" = "line",
    ) => {
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (!cleaned) return;
      lines.push({
        section: currentSection,
        h2: currentH2,
        text: cleaned,
        kind,
        isSection,
      });
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "summary") {
          currentSection = el.textContent?.trim() || "";
          if (currentSection) pushLine(currentSection, true, "section");
          return;
        }
        if (tag === "h2") {
          currentH2 = el.textContent?.replace(/\s+/g, " ").trim() || "";
          if (currentH2) pushLine(currentH2, false, "h2");
          return;
        }
        if (
          [
            "p",
            "li",
            "h1",
            "h3",
            "h4",
            "h5",
            "h6",
            "blockquote",
            "td",
            "th",
          ].includes(tag)
        ) {
          pushLine(el.textContent || "");
          return;
        }
        Array.from(el.childNodes).forEach((child) => walk(child));
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) pushLine(node.textContent || "");
    };

    Array.from(doc.body.childNodes).forEach((child) => walk(child));
    return lines;
  };

  const highlightText = (text: string, term: string) => {
    if (!term) return text;
    const safeTerm = escapeRegExp(term);
    const parts = text.split(new RegExp(`(${safeTerm})`, "ig"));
    return parts.map((part, index) =>
      index % 2 === 1 ? (
        <mark class="rounded-sm bg-amber-200 px-0.5 text-gray-900">{part}</mark>
      ) : (
        <span>{part}</span>
      ),
    );
  };

  const splitSentences = (text: string): string[] => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const matches = normalized.match(/[^.!?]+[.!?]?/g);
    if (!matches) return [normalized];
    return matches.map((part) => part.trim()).filter(Boolean);
  };

  const createContextSnippet = (text: string, maxLength = 140) => {
    const sentences = splitSentences(text);
    if (!sentences.length) return "";
    let snippet = "";
    let used = 0;
    for (const sentence of sentences) {
      const nextLength = used + (snippet ? 1 : 0) + sentence.length;
      if (snippet && nextLength > maxLength) break;
      snippet = snippet ? `${snippet} ${sentence}` : sentence;
      used = snippet.length;
      if (used >= maxLength) break;
    }
    if (!snippet) snippet = sentences[0];
    return sentences.length > 1 && snippet.length < text.trim().length
      ? `${snippet}…`
      : snippet;
  };

  const createMatchSnippet = (
    text: string,
    term: string,
    maxLength = 180,
  ) => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return cleaned;
    const normalizedTerm = term.trim().toLowerCase();
    if (!normalizedTerm) return createContextSnippet(cleaned);

    const sentences = splitSentences(cleaned);
    if (!sentences.length) return cleaned;
    const matchIndex = sentences.findIndex((sentence) =>
      sentence.toLowerCase().includes(normalizedTerm),
    );
    if (matchIndex < 0) return createContextSnippet(cleaned, maxLength);

    let start = matchIndex;
    let end = matchIndex;
    let combined = sentences[matchIndex];
    while (combined.length < maxLength) {
      const canAddPrev = start > 0;
      const canAddNext = end < sentences.length - 1;
      if (!canAddPrev && !canAddNext) break;

      const prevCandidate = canAddPrev ? `${sentences[start - 1]} ${combined}` : "";
      const nextCandidate = canAddNext ? `${combined} ${sentences[end + 1]}` : "";

      const prevWithin = canAddPrev && prevCandidate.length <= maxLength;
      const nextWithin = canAddNext && nextCandidate.length <= maxLength;

      if (!prevWithin && !nextWithin) break;
      if (prevWithin && (!nextWithin || prevCandidate.length <= nextCandidate.length)) {
        start -= 1;
        combined = prevCandidate;
        continue;
      }
      end += 1;
      combined = nextCandidate;
    }

    const prefix = start > 0 ? "… " : "";
    const suffix = end < sentences.length - 1 ? " …" : "";
    return `${prefix}${combined}${suffix}`;
  };

  const availableCategories = createMemo(() =>
    Array.from(
      new Set(
        handbookEntries()
          .map((entry) => (entry.category || "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b)),
  );

  const searchResults = createMemo<SearchResult[]>(() => {
    const term = searchTerm().trim();
    if (term.length < 3) return [];
    const normalizedTerm = term.toLowerCase();
    const activeCategory = selectedCategory().trim().toLowerCase();
    const results: SearchResult[] = [];

    handbookEntries().forEach((entry) => {
      const category = entry.category || "Untitled category";
      if (activeCategory && category.toLowerCase() !== activeCategory) return;
      const categoryMatch = category.toLowerCase().includes(normalizedTerm);
      const lines = extractContentLines(entry.content || "");
      let matched = false;

      lines.forEach((line, index) => {
        if (!line.text.toLowerCase().includes(normalizedTerm)) return;
        matched = true;
        let targetKind: "line" | "section" = "line";
        const matchedSnippet = createMatchSnippet(line.text, term);
        const nextLine = lines[index + 1]?.text;
        const previousLine = lines[index - 1]?.text;
        const contextLine = nextLine || previousLine;
        let snippetLines = [
          matchedSnippet,
          contextLine ? createContextSnippet(contextLine) : "",
        ].filter(Boolean) as string[];
        if (line.kind === "h2") {
          // Keep H2 matches focused on the heading itself.
          targetKind = "section";
          snippetLines = [];
        }
        if (line.isSection) {
          targetKind = "section";
          const afterLines = lines
            .slice(index + 1)
            .filter((item) => !item.isSection)
            .slice(0, 2)
            .map((item) => createContextSnippet(item.text));
          snippetLines = afterLines;
        }
        results.push({
          id: entry.id,
          category,
          h2: line.h2,
          section: line.section,
          lines: snippetLines,
          targetText: targetKind === "line" ? matchedSnippet : line.text,
          targetKind,
        });
      });

      if (!matched && categoryMatch) {
        results.push({
          id: entry.id,
          category,
          h2: "",
          section: "",
          lines: [],
          targetText: category,
          targetKind: "category",
        });
      }
    });

    return results;
  });

  const addRecentSearch = (value: string) => {
    const normalized = value.trim();
    if (normalized.length < 3) return;
    setRecentSearches((prev) =>
      [
        normalized,
        ...prev.filter(
          (item) => item.trim().toLowerCase() !== normalized.toLowerCase(),
        ),
      ].slice(0, MAX_RECENT_SEARCHES),
    );
  };

  const removeRecentSearch = (value: string) => {
    const normalized = value.trim().toLowerCase();
    setRecentSearches((prev) =>
      prev.filter((item) => item.trim().toLowerCase() !== normalized),
    );
  };

  const clearCloseResetTimer = () => {
    if (closeResetTimerId !== undefined) {
      window.clearTimeout(closeResetTimerId);
      closeResetTimerId = undefined;
    }
  };

  const closeModal = () => {
    if (closeInProgress) return;
    closeInProgress = true;
    clearCloseResetTimer();
    closeResetTimerId = window.setTimeout(() => {
      closeInProgress = false;
      closeResetTimerId = undefined;
    }, 600);
    addRecentSearch(searchTerm());
    setSearchTerm("");
    setSearchInputFocused(false);
    props.onClose();
  };

  const handleBackPressStart = (event: Event) => {
    event.preventDefault();
    closeModal();
  };

  const shouldShowRecentSearches = () =>
    isOpen() &&
    searchInputFocused() &&
    searchTerm().trim().length > 0 &&
    matchingRecentSearches().length > 0;

  const matchingRecentSearches = createMemo(() => {
    const term = searchTerm().trim().toLowerCase();
    if (!term) return recentSearches();
    return recentSearches().filter((item) =>
      item.trim().toLowerCase().includes(term),
    );
  });

  const clearAutofocusTimers = () => {
    if (autofocusRetryTimerId !== undefined) {
      window.clearTimeout(autofocusRetryTimerId);
      autofocusRetryTimerId = undefined;
    }
  };

  const focusSearchInput = (attempt = 0) => {
    if (!isOpen()) return;

    const input = searchInputRef;
    if (!input) {
      if (attempt >= MAX_AUTOFOCUS_ATTEMPTS) return;
      autofocusRetryTimerId = window.setTimeout(
        () => focusSearchInput(attempt + 1),
        120,
      );
      return;
    }

    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    const isFocused = document.activeElement === input;
    if (isFocused) {
      const valueLength = input.value.length;
      if (valueLength > 0) {
        input.setSelectionRange(valueLength, valueLength);
      }
      return;
    }

    if (attempt >= MAX_AUTOFOCUS_ATTEMPTS) {
      return;
    }

    autofocusRetryTimerId = window.setTimeout(
      () => focusSearchInput(attempt + 1),
      120,
    );
  };

  createEffect(() => {
    if (!isOpen()) {
      clearAutofocusTimers();
      return;
    }

    clearCloseResetTimer();
    closeInProgress = false;
    void untrack(loadSearchIndex);
    clearAutofocusTimers();
    queueMicrotask(() => {
      focusSearchInput();
    });
  });

  createEffect(() => {
    if (!searchLoaded()) return;
    const current = selectedCategory().trim();
    if (!current) return;
    if (availableCategories().includes(current)) return;
    setSelectedCategory("");
  });

  createEffect(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_HANDBOOK_RECENT_SEARCHES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, MAX_RECENT_SEARCHES);
      setRecentSearches(cleaned);
    } catch {
      // Ignore storage errors.
    }
  });

  createEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_HANDBOOK_RECENT_SEARCHES_KEY,
        JSON.stringify(recentSearches()),
      );
    } catch {
      // Ignore storage errors.
    }
  });

  onCleanup(() => {
    clearAutofocusTimers();
    clearCloseResetTimer();
  });

  return (
    <Show when={isOpen()}>
        <div
          class={
            props.renderAsPage
              ? "flex min-h-dvh w-full flex-col bg-white"
              : "fixed inset-0 z-50 flex min-h-dvh w-full flex-col bg-white"
          }
        >
          <div class="sticky top-0 z-20 border-b border-gray-200 bg-white px-4 py-4">
            <div class="mx-auto max-w-7xl">
              <div class="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1 gap-y-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-x-3">
                <div class="col-start-1 row-start-1">
                  <IconButton
                    type="button"
                    onPointerDown={handleBackPressStart}
                    onTouchStart={handleBackPressStart}
                    onClick={closeModal}
                    size="lg"
                    aria-label="Back"
                  >
                    <TbOutlineArrowLeft class="h-5 w-5" />
                  </IconButton>
                </div>
                <div class="relative col-start-2 row-start-1 min-w-0">
                  <input
                    type="search"
                    ref={searchInputRef}
                    autofocus
                    value={searchTerm()}
                    onFocus={() => setSearchInputFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setSearchInputFocused(false), 120);
                    }}
                    onInput={(e) => setSearchTerm(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      addRecentSearch(searchTerm());
                    }}
                    placeholder={
                      selectedCategory() ? "Search category..." : "Search handbook..."
                    }
                    class="handbook-search-input h-11 w-full rounded-full border border-gray-200 bg-gray-50 px-4 text-base text-gray-800 shadow-inner focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <Show when={shouldShowRecentSearches()}>
                    <div class="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                      <For each={matchingRecentSearches()}>
                        {(term) => (
                          <div class="flex items-center gap-1">
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setSearchTerm(term);
                                setSearchInputFocused(false);
                                searchInputRef?.focus();
                                searchInputRef?.setSelectionRange(
                                  term.length,
                                  term.length,
                                );
                              }}
                              class="flex-1 rounded-lg px-3 py-2 text-left text-base text-gray-700 hover:bg-gray-50"
                            >
                              {term}
                            </button>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => removeRecentSearch(term)}
                              class="rounded-lg px-2 py-2 text-base text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              aria-label={`Delete ${term}`}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <Show when={availableCategories().length > 0}>
                  <div class="col-start-2 row-start-2 min-w-0 lg:col-start-3 lg:row-start-1 lg:w-64">
                    <select
                      id="handbook-search-category"
                      aria-label="Search in"
                      value={selectedCategory()}
                      onChange={(e) => setSelectedCategory(e.currentTarget.value)}
                      class="h-9 w-full rounded-full border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                    >
                      <option value="">All categories</option>
                      <For each={availableCategories()}>
                        {(category) => (
                          <option value={category}>{category}</option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        <div class="flex-1 overflow-y-auto">
          <div class="mx-auto max-w-7xl px-4 py-6">
            <Show
              when={!searchLoading()}
              fallback={
                <LoadingState
                  label="Loading handbook search..."
                  class="justify-start text-gray-500"
                />
              }
            >
              <Show
                when={!searchError()}
                fallback={<p class="text-base text-red-600">{searchError()}</p>}
              >
                <Show
                  when={searchTerm().trim()}
                  fallback={<></>}
                >
                  <Show
                    when={searchTerm().trim().length >= 3}
                    fallback={<></>}
                  >
                    <Show
                      when={searchResults().length > 0}
                      fallback={
                        <p class="text-base text-gray-600">No matching results.</p>
                      }
                    >
                      <div class="space-y-3">
                        <For each={searchResults()}>
                          {(result) => (
                            <A
                              href={`/handbook/${result.id}?q=${encodeURIComponent(
                                searchTerm().trim(),
                              )}&t=${encodeURIComponent(
                                result.targetText || result.category || "",
                              )}&tk=${encodeURIComponent(
                                result.targetKind,
                              )}`}
                              replace={props.replaceResultNavigation}
                              onClick={() => {
                                addRecentSearch(searchTerm());
                                if (props.closeOnResultClick ?? true) {
                                  props.onClose();
                                }
                              }}
                              class="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                            >
                              <div class="flex items-baseline gap-2">
                                <div class="text-base font-semibold text-gray-900">
                                  {highlightText(
                                    result.category || "Untitled category",
                                    searchTerm().trim(),
                                  )}
                                </div>
                                <Show when={result.h2}>
                                  <div class="text-sm font-medium text-gray-500">
                                    / {highlightText(result.h2, searchTerm().trim())}
                                  </div>
                                </Show>
                              </div>
                              <Show when={result.section}>
                                <div class="mt-1 text-sm font-semibold uppercase text-primary">
                                  {highlightText(
                                    result.section,
                                    searchTerm().trim(),
                                  )}
                                </div>
                              </Show>
                              <Show when={result.lines.length > 0}>
                                <div class="mt-2 space-y-1 text-sm text-gray-600">
                                  <For each={result.lines}>
                                    {(line) => (
                                      <p>
                                        {highlightText(line, searchTerm().trim())}
                                      </p>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </A>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default HandbookSearchModal;
