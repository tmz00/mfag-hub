import {
  Component,
  Show,
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { TbOutlineArrowLeft, TbOutlineSearch } from "solid-icons/tb";
import { AuthenticatedImage } from "../../../components/AuthenticatedImage";
import { PageShell, Button, LoadingState } from "../../../components/ui";
import { getCaptchaAwareErrorMessage } from "../../../services/authService";

import { getHandbookEntries } from "../../../services/handbookContentService";
import {
  fetchHandbookFile,
  isHandbookApiFileUrl,
  resolveHandbookFileUrl,
} from "../../../services/handbookFilesService";
import { sanitizeHandbookHtml } from "../../../utils/sanitizeHandbookHtml";

type HandbookEntry = {
  category?: string;
  content?: string;
  imageUrl?: string;
  imagePath?: string;
};

const preserveTextLineBreaks = (html: string): string => {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHandbookHtml(html);

  const blocks = container.querySelectorAll<HTMLElement>(
    "p, li, blockquote, td, th, summary",
  );
  blocks.forEach((block) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    textNodes.forEach((node) => {
      const value = node.nodeValue || "";
      if (!value.includes("\n")) return;
      if (node.parentElement?.closest("pre, code")) return;

      const parts = value.split("\n");
      const fragment = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (part) {
          fragment.appendChild(document.createTextNode(part));
        }
        if (index < parts.length - 1) {
          fragment.appendChild(document.createElement("br"));
        }
      });
      node.parentNode?.replaceChild(fragment, node);
    });
  });

  return container.innerHTML;
};

const MIN_CONTENT_BOTTOM_PADDING_PX = 32;
const FINAL_SECTION_TOP_CUSHION_PX = 8;

const HandbookView: Component = () => {
  const navigate = useNavigate();
  const params = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();
  const [entry, setEntry] = createSignal<HandbookEntry | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [fileOpenError, setFileOpenError] = createSignal("");
  const [showStickyHeader, setShowStickyHeader] = createSignal(false);
  const [showSearchFab, setShowSearchFab] = createSignal(false);
  const [currentSection, setCurrentSection] = createSignal("");
  const [contentEl, setContentEl] = createSignal<HTMLDivElement | null>(null);
  const [sectionList, setSectionList] = createSignal<
    { id: string; title: string }[]
  >([]);
  const [showSectionMenu, setShowSectionMenu] = createSignal(false);
  const [sectionMenuRoot, setSectionMenuRoot] =
    createSignal<HTMLDivElement | null>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = createSignal(0);
  const [contentBottomPaddingPx, setContentBottomPaddingPx] = createSignal(
    MIN_CONTENT_BOTTOM_PADDING_PX,
  );
  let appliedSearchJumpKey = "";
  let stickySentinelRef: HTMLDivElement | undefined;
  let stickyHeaderRef: HTMLDivElement | undefined;
  const getSearchParamValue = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value || "").trim();
  const deepLinkQuery = createMemo(() => getSearchParamValue(searchParams.q));
  const deepLinkTargetText = createMemo(() =>
    getSearchParamValue(searchParams.t),
  );
  const deepLinkTargetKind = createMemo(() =>
    getSearchParamValue(searchParams.tk).toLowerCase(),
  );
  const hasSectionHeadings = createMemo(() => sectionList().length > 0);
  const getSectionHeadings = () =>
    Array.from(contentEl()?.querySelectorAll<HTMLHeadingElement>("h2") || []);

  const hrefFromLink = (el: HTMLAnchorElement) =>
    (el.getAttribute("href") || "").trim();

  const isPdfLink = (el: HTMLAnchorElement) =>
    /\.pdf(\?|#|$)/i.test(hrefFromLink(el));

  const isImageLink = (el: HTMLAnchorElement) =>
    /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(hrefFromLink(el));

  const isProtectedHandbookFileLink = (el: HTMLAnchorElement) =>
    isHandbookApiFileUrl(hrefFromLink(el));

  const openLinkedFile = async (href: string, requiresAuth: boolean) => {
    setFileOpenError("");

    try {
      const response = requiresAuth
        ? await fetchHandbookFile(href)
        : await fetch(href);
      if (!response.ok) {
        throw new Error(`Unable to load file (${response.status})`);
      }

      const blob = await response.blob();
      const mimeType = response.headers.get("Content-Type") || blob.type;
      const blobUrl = URL.createObjectURL(
        mimeType ? new Blob([blob], { type: mimeType }) : blob,
      );
      window.open(blobUrl, "_blank");
    } catch (err) {
      console.error("Failed to open handbook file", err);
      if (requiresAuth) {
        setFileOpenError(
          getCaptchaAwareErrorMessage(
            err,
            "Unable to open this file right now. Please try again.",
          ),
        );
        return;
      }

      window.open(href, "_blank");
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

  const openCategorySearch = () => {
    const category = (entry()?.category || "").trim();
    const returnTo = `${window.location.pathname}${window.location.search}`;
    navigate(
      category
        ? `/handbook/search?category=${encodeURIComponent(category)}&replace=1&returnTo=${encodeURIComponent(returnTo)}`
        : `/handbook/search?replace=1&returnTo=${encodeURIComponent(returnTo)}`,
      { replace: true },
    );
  };

  onMount(async () => {
    setLoading(true);
    setError("");
    try {
      const parsed = await getHandbookEntries();
      if (!Array.isArray(parsed)) {
        setError("This handbook category is unavailable.");
        return;
      }
      const index = Number(params.categoryId);
      if (!Number.isFinite(index) || index < 0) {
        setError("This handbook category is unavailable.");
        return;
      }
      const current = parsed[index] as HandbookEntry | undefined;
      if (!current) {
        setError("This handbook category is unavailable.");
        return;
      }
      const cleanedContent = (current.content || "")
        .replace(
          /<details([^>]*)\sopen(?:=(\"[^\"]*\"|'[^']*'|[^\s>]+))?/gi,
          "<details$1",
        )
        .replace(/<p>\s*<\/p>/gi, "<p><br></p>");
      const normalizedContent = preserveTextLineBreaks(cleanedContent);
      setEntry({
        ...current,
        imageUrl: current.imageUrl,
        content: normalizedContent,
      });
    } catch (err) {
      console.error("Failed to load handbook category", err);
      setError(
        getCaptchaAwareErrorMessage(err, "Unable to load handbook category."),
      );
    } finally {
      setLoading(false);
    }
  });

  onMount(() => {
    const updateSticky = () => {
      if (!stickySentinelRef) {
        return;
      }
      setShowStickyHeader(stickySentinelRef.getBoundingClientRect().top <= 24);
      setShowSearchFab(window.scrollY > 280);
      setStickyHeaderHeight(stickyHeaderRef?.offsetHeight || 0);
      if (!currentSection()) {
        const headings = getSectionHeadings();
        if (headings.length > 0) {
          setCurrentSection(headings[0].textContent?.trim() || "");
        }
      }
    };
    updateSticky();
    window.addEventListener("scroll", updateSticky, { passive: true });
    window.addEventListener("resize", updateSticky);
    onCleanup(() => {
      window.removeEventListener("scroll", updateSticky);
      window.removeEventListener("resize", updateSticky);
    });
  });

  onMount(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const root = sectionMenuRoot();
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      setShowSectionMenu(false);
    };
    document.addEventListener("click", handleDocumentClick);
    onCleanup(() => {
      document.removeEventListener("click", handleDocumentClick);
    });
  });

  createEffect(() => {
    if (!entry()?.content || !contentEl()) {
      return;
    }
    let cleanupFn: (() => void) | undefined;
    const setupObserver = (attemptsLeft = 8) => {
      const headings = getSectionHeadings();
      if (headings.length === 0) {
        if (attemptsLeft > 0) {
          requestAnimationFrame(() => setupObserver(attemptsLeft - 1));
          return;
        }
        setCurrentSection("");
        return;
      }
      const updateSection = () => {
        const active =
          headings
            .filter((heading) => heading.getBoundingClientRect().top <= 40)
            .pop() || headings[0];
        setCurrentSection(active.textContent?.trim() || "");
      };
      updateSection();
      window.addEventListener("scroll", updateSection, { passive: true });
      window.addEventListener("resize", updateSection);
      cleanupFn = () => {
        window.removeEventListener("scroll", updateSection);
        window.removeEventListener("resize", updateSection);
      };
    };

    requestAnimationFrame(() => setupObserver());
    onCleanup(() => cleanupFn?.());
  });

  createEffect(() => {
    if (!contentEl()) return;
    const headings = getSectionHeadings();
    const used = new Map<string, number>();
    const slugify = (value: string) => {
      const base = value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      return count === 0 ? base : `${base}-${count + 1}`;
    };
    const sections = headings.map((heading) => {
      const title = heading.textContent?.trim() || "Section";
      if (!heading.id) {
        heading.id = `section-${slugify(title)}`;
      }
      return { id: heading.id, title };
    });
    setSectionList(sections);
  });

  createEffect(() => {
    if (!showStickyHeader() || !hasSectionHeadings()) {
      setShowSectionMenu(false);
    }
  });

  createEffect(() => {
    const el = contentEl();
    const content = entry()?.content;
    const sectionCount = sectionList().length;
    void sectionCount;
    if (!el || !content || typeof window === "undefined") {
      setContentBottomPaddingPx(MIN_CONTENT_BOTTOM_PADDING_PX);
      return;
    }

    let animationFrameId: number | undefined;

    const measureBottomPadding = () => {
      const headingNodes = getSectionHeadings();
      const lastHeading = headingNodes[headingNodes.length - 1];
      const contentHeight = Math.max(0, el.scrollHeight);

      let finalSectionHeight = contentHeight;
      if (lastHeading) {
        const contentRect = el.getBoundingClientRect();
        const headingRect = lastHeading.getBoundingClientRect();
        const sectionTopOffset = Math.max(0, headingRect.top - contentRect.top);
        finalSectionHeight = Math.max(0, contentHeight - sectionTopOffset);
      }

      const viewportHeight = Math.max(0, window.innerHeight || 0);
      const stickyOffset = Math.max(
        0,
        stickyHeaderRef?.offsetHeight || 0,
      );
      const neededPadding =
        viewportHeight + stickyOffset - finalSectionHeight + FINAL_SECTION_TOP_CUSHION_PX;
      setContentBottomPaddingPx(
        Math.max(MIN_CONTENT_BOTTOM_PADDING_PX, Math.ceil(neededPadding)),
      );
    };

    const scheduleMeasure = () => {
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = undefined;
        measureBottomPadding();
      });
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => scheduleMeasure())
        : null;
    resizeObserver?.observe(el);
    const lastHeading = getSectionHeadings().at(-1);
    if (lastHeading) {
      resizeObserver?.observe(lastHeading);
    }

    window.addEventListener("resize", scheduleMeasure);

    onCleanup(() => {
      window.removeEventListener("resize", scheduleMeasure);
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }
      resizeObserver?.disconnect();
    });
  });

  // Wrap answer content inside <details> in a wrapper div for consistent border-left styling
  createEffect(() => {
    const el = contentEl();
    if (!el) return;
    el.querySelectorAll("details").forEach((details) => {
      if (details.querySelector(".details-answer")) return;
      const summary = details.querySelector("summary");
      if (summary && !summary.querySelector(":scope > .summary-text")) {
        const textWrapper = document.createElement("span");
        textWrapper.className = "summary-text";
        const summaryChildren = Array.from(summary.childNodes);
        summaryChildren.forEach((child) => {
          textWrapper.appendChild(child);
        });
        summary.appendChild(textWrapper);
      }
      const wrapper = document.createElement("div");
      wrapper.className = "details-answer";
      const children = Array.from(details.childNodes);
      for (const child of children) {
        if (child === summary) continue;
        wrapper.appendChild(child);
      }
      details.appendChild(wrapper);
    });
  });

  createEffect(() => {
    const el = contentEl();
    const content = entry()?.content;
    if (!el || !content) return;
    if (
      typeof window === "undefined" ||
      typeof window.URL?.createObjectURL !== "function"
    ) {
      return;
    }

    let disposed = false;
    const objectUrls: string[] = [];

    el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const source = (img.getAttribute("src") || "").trim();
      if (!isHandbookApiFileUrl(source)) return;

      void (async () => {
        try {
          const response = await fetchHandbookFile(source);
          if (!response.ok) {
            throw new Error(`Unable to load image (${response.status})`);
          }

          const blob = await response.blob();
          const objectUrl = window.URL.createObjectURL(blob);
          if (disposed) {
            window.URL.revokeObjectURL(objectUrl);
            return;
          }

          objectUrls.push(objectUrl);
          img.src = objectUrl;
        } catch {
          // Leave the existing src in place so the broken state remains visible.
        }
      })();
    });

    onCleanup(() => {
      disposed = true;
      if (typeof window.URL?.revokeObjectURL !== "function") {
        return;
      }
      objectUrls.forEach((url) => window.URL.revokeObjectURL(url));
    });
  });

  // Animate details open/close explicitly (native details close is instant in Safari)
  createEffect(() => {
    const el = contentEl();
    if (!el) return;

    const cleanups: Array<() => void> = [];
    let pendingScrollTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingOpenTimer: ReturnType<typeof setTimeout> | undefined;

    const isStickyHeaderVisible = () => {
      const sticky = document.querySelector<HTMLElement>(
        "[data-handbook-sticky-header='true']",
      );
      if (!sticky) return false;
      const rect = sticky.getBoundingClientRect();
      if (rect.height <= 0) return false;
      const styles = window.getComputedStyle(sticky);
      return (
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        parseFloat(styles.opacity || "1") > 0.01
      );
    };

    const getStickyHeaderBottom = () => {
      const sticky = document.querySelector<HTMLElement>(
        "[data-handbook-sticky-header='true']",
      );
      if (!sticky || !isStickyHeaderVisible()) return 0;
      const rect = sticky.getBoundingClientRect();
      return Math.max(0, rect.bottom);
    };

    const scrollSummaryIntoView = (
      details: HTMLDetailsElement,
      behavior: ScrollBehavior,
      useStickyOffset: boolean,
    ) => {
      const summary = details.querySelector("summary");
      const target = summary instanceof HTMLElement ? summary : details;
      const stickyBottom = useStickyOffset ? getStickyHeaderBottom() : 0;
      const targetTop =
        target.getBoundingClientRect().top +
        (window.scrollY || window.pageYOffset || 0);
      const destination = Math.max(0, targetTop - stickyBottom - 8);
      window.scrollTo({ top: destination, behavior });
    };

    const closeDetailsWithAnimation = (
      details: HTMLDetailsElement,
      onFinished?: () => void,
    ) => {
      const answer = details.querySelector(
        ".details-answer",
      ) as HTMLElement | null;
      if (!answer) {
        details.dataset.animating = "0";
        details.removeAttribute("open");
        onFinished?.();
        return;
      }

      ensureAnswerTransition(answer);
      details.dataset.animating = "1";
      answer.style.maxHeight = `${answer.scrollHeight}px`;
      answer.style.opacity = "1";

      requestAnimationFrame(() => {
        answer.style.maxHeight = "0px";
        answer.style.opacity = "0";
      });

      let done = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        answer.removeEventListener("transitionend", onEnd);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        details.removeAttribute("open");
        answer.style.maxHeight = "";
        answer.style.opacity = "";
        details.dataset.animating = "0";
        onFinished?.();
      };
      const onEnd = (event: Event) => {
        if (event.target !== answer) return;
        finish();
      };
      answer.addEventListener("transitionend", onEnd);
      fallbackTimer = setTimeout(finish, 420);
    };

    const ensureAnswerTransition = (answer: HTMLElement) => {
      // Force transition inline so Safari/iPad still animates even when
      // prefers-reduced-motion styles disable class-based transitions.
      answer.style.transition =
        "max-height 0.32s ease, opacity 0.22s ease, padding-top 0.22s ease, padding-bottom 0.22s ease, border-color 0.22s ease";
    };

    const openDetailsWithAnimation = (details: HTMLDetailsElement) => {
      const answer = details.querySelector(
        ".details-answer",
      ) as HTMLElement | null;
      if (!answer) {
        details.setAttribute("open", "");
        details.dataset.animating = "0";
        return;
      }
      ensureAnswerTransition(answer);
      details.dataset.animating = "1";
      details.setAttribute("open", "");
      answer.style.maxHeight = "0px";
      answer.style.opacity = "0";

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          answer.style.maxHeight = `${answer.scrollHeight}px`;
          answer.style.opacity = "1";
        });
      });

      let done = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        answer.removeEventListener("transitionend", onEnd);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        answer.style.maxHeight = "";
        answer.style.opacity = "";
        details.dataset.animating = "0";
      };
      const onEnd = (event: Event) => {
        if (event.target !== answer) return;
        finish();
      };
      answer.addEventListener("transitionend", onEnd);
      fallbackTimer = setTimeout(finish, 420);
    };

    const clearPendingTimers = () => {
      if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
      if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
      pendingScrollTimer = undefined;
      pendingOpenTimer = undefined;
    };

    const waitUntilStickyThen = (run: () => void) => {
      if (isStickyHeaderVisible()) {
        run();
        return;
      }
      const firstSummary = el.querySelector(
        "details > summary",
      ) as HTMLElement | null;
      if (firstSummary) {
        const top =
          firstSummary.getBoundingClientRect().top +
          (window.scrollY || window.pageYOffset || 0);
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        pendingScrollTimer = setTimeout(() => {
          run();
        }, 280);
        return;
      }
      run();
    };

    el.querySelectorAll("details").forEach((details) => {
      const summary = details.querySelector("summary");
      const answer = details.querySelector(
        ".details-answer",
      ) as HTMLElement | null;
      if (!(summary instanceof HTMLElement) || !answer) return;
      ensureAnswerTransition(answer);

      const onToggle = (event: MouseEvent) => {
        event.preventDefault();
        clearPendingTimers();
        if (details.dataset.animating === "1") return;

        if (details.hasAttribute("open")) {
          closeDetailsWithAnimation(details, () => {
            scrollSummaryIntoView(details, "smooth", true);
          });
          return;
        }

        waitUntilStickyThen(() => {
          const currentOpen = Array.from(
            el.querySelectorAll<HTMLDetailsElement>("details[open]"),
          ).find((openDetails) => openDetails !== details);

          if (!currentOpen) {
            scrollSummaryIntoView(details, "smooth", true);
            openDetailsWithAnimation(details);
            return;
          }

          // Match Products sequence: close current, then scroll, then open target.
          closeDetailsWithAnimation(currentOpen);
          pendingScrollTimer = setTimeout(() => {
            scrollSummaryIntoView(details, "smooth", true);
            pendingOpenTimer = setTimeout(() => {
              openDetailsWithAnimation(details);
            }, 220);
          }, 280);
        });
      };

      summary.addEventListener("click", onToggle);
      cleanups.push(() => {
        summary.removeEventListener("click", onToggle);
      });
    });

    onCleanup(() => {
      clearPendingTimers();
      cleanups.forEach((fn) => fn());
    });
  });

  // Intercept PDF/Image link clicks to open in-app viewer
  createEffect(() => {
    const el = contentEl();
    if (!el) return;
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.(
        "a",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const rawHref = hrefFromLink(anchor);
      if (isProtectedHandbookFileLink(anchor)) {
        e.preventDefault();
        void openLinkedFile(rawHref, true);
        return;
      }
      if (isImageLink(anchor) || isPdfLink(anchor)) {
        e.preventDefault();
        void openLinkedFile(anchor.href, false);
      }
    };
    el.addEventListener("click", handleClick);
    onCleanup(() => el.removeEventListener("click", handleClick));
  });

  // Ensure file links open in a new window if default navigation wins.
  createEffect(() => {
    const el = contentEl();
    if (!el) return;
    el.querySelectorAll("a").forEach((anchor) => {
      const rawHref = hrefFromLink(anchor);
      const isProtected = isHandbookApiFileUrl(rawHref);

      if (isProtected) {
        anchor.setAttribute("href", resolveHandbookFileUrl(rawHref));
      }

      if (!isImageLink(anchor) && !isProtected) return;
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    });
  });

  const scrollToSection = (id: string) => {
    const target = contentEl()?.querySelector(`#${CSS.escape(id)}`);
    if (target instanceof HTMLElement) {
      const headerOffset =
        stickyHeaderRef?.offsetHeight || stickyHeaderHeight() || 0;
      const targetTop =
        target.getBoundingClientRect().top +
        (window.scrollY || window.pageYOffset || 0);
      const destination = Math.max(
        0,
        targetTop + target.offsetHeight - headerOffset,
      );
      window.scrollTo({ top: destination, behavior: "smooth" });
    }
    setShowSectionMenu(false);
  };

  createEffect(() => {
    const container = contentEl();
    const query = deepLinkQuery();
    const targetText = deepLinkTargetText();
    const targetKind = deepLinkTargetKind();
    const currentEntry = entry();
    if (!container || !query || !currentEntry?.content) return;

    const jumpKey = `${params.categoryId}:${query.toLowerCase()}:${targetKind}:${targetText.toLowerCase()}`;
    if (appliedSearchJumpKey === jumpKey) return;

    const normalize = (value: string) =>
      value.replace(/[.…]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedQuery = normalize(query);

    const allCandidates = Array.from(
      container.querySelectorAll<HTMLElement>(
        "summary, p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span, div",
      ),
    );
    const findByText = (nodes: HTMLElement[], text: string) => {
      const matches = nodes.filter((node) =>
        normalize(node.textContent || "").includes(text),
      );
      if (matches.length === 0) return undefined;
      return matches.sort((a, b) => {
        const aLen = normalize(a.textContent || "").length;
        const bLen = normalize(b.textContent || "").length;
        return aLen - bLen;
      })[0];
    };

    let match: HTMLElement | undefined;
    const normalizedTarget = normalize(targetText);
    if (normalizedTarget) {
      if (targetKind === "line") {
        const bodyFirst = Array.from(
          container.querySelectorAll<HTMLElement>(
            ".details-answer p, .details-answer li, .details-answer blockquote, .details-answer td, .details-answer th, p, li, blockquote, td, th",
          ),
        );
        const scopedBody = bodyFirst.filter((node) => !node.closest("summary"));
        match = findByText(scopedBody, normalizedTarget);
      } else if (targetKind === "section") {
        const sectionNodes = allCandidates.filter((node) =>
          /^(summary|h1|h2|h3|h4|h5|h6)$/i.test(node.tagName),
        );
        match = findByText(sectionNodes, normalizedTarget);
      } else {
        const headingNodes = allCandidates.filter((node) =>
          /^(h1|h2|h3|h4|h5|h6)$/i.test(node.tagName),
        );
        match = findByText(headingNodes, normalizedTarget);
      }
    }

    if (!match) {
      match = allCandidates.find((node) =>
        normalize(node.textContent || "").includes(normalizedQuery),
      );
    }
    if (!match) return;

    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const highlightTerms = query
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    const highlightRegex = new RegExp(
      `(${highlightTerms.map(escapeRegExp).join("|")})`,
      "ig",
    );

    const applyKeywordHighlight = (root: HTMLElement) => {
      const marks: HTMLElement[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const text = node.nodeValue || "";
          if (!text.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const textNodes: Text[] = [];
      let current: Node | null = walker.nextNode();
      while (current) {
        textNodes.push(current as Text);
        current = walker.nextNode();
      }

      textNodes.forEach((textNode) => {
        const text = textNode.nodeValue || "";
        if (!highlightRegex.test(text)) return;
        highlightRegex.lastIndex = 0;
        const fragments = text.split(highlightRegex);
        if (fragments.length <= 1) return;

        const fragment = document.createDocumentFragment();
        fragments.forEach((part, index) => {
          if (!part) return;
          if (index % 2 === 1) {
            const mark = document.createElement("mark");
            const inSummary = textNode.parentElement?.closest("summary");
            mark.className = inSummary
              ? "bg-amber-200/80 text-inherit"
              : "rounded-sm bg-amber-200 px-0.5 text-gray-900";
            mark.dataset.searchHitTemp = "1";
            mark.textContent = part;
            marks.push(mark);
            fragment.appendChild(mark);
            return;
          }
          fragment.appendChild(document.createTextNode(part));
        });

        textNode.parentNode?.replaceChild(fragment, textNode);
      });

      return () => {
        marks.forEach((mark) => {
          const parent = mark.parentNode;
          if (!parent) return;
          parent.replaceChild(
            document.createTextNode(mark.textContent || ""),
            mark,
          );
          parent.normalize();
        });
      };
    };

    let clearHighlightTimer: number | undefined;
    let mainScrollTimer: number | undefined;
    let correctionTimer: number | undefined;
    let clearKeywordHighlight: (() => void) | undefined;
    let inlineScrollAnchor: HTMLSpanElement | undefined;

    const createInlineScrollAnchor = (
      root: HTMLElement,
      preferredText: string,
      fallbackText: string,
    ) => {
      const normalizedPreferred = preferredText
        .replace(/^[.…\s]+/, "")
        .replace(/[.…\s]+$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const fallbackTerm = fallbackText
        .split(/\s+/)
        .map((part) => part.trim())
        .find((part) => part.length >= 3)
        ?.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const text = node.nodeValue || "";
          if (!text.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: Text[] = [];
      let current: Node | null = walker.nextNode();
      while (current) {
        textNodes.push(current as Text);
        current = walker.nextNode();
      }

      const findOffsetWithWhitespaceNormalization = (
        rawText: string,
        needle: string,
      ) => {
        if (!needle) return -1;
        const chars: string[] = [];
        const mapToRawIndex: number[] = [];
        let previousWasSpace = false;
        for (let i = 0; i < rawText.length; i += 1) {
          const char = rawText[i];
          if (char === "…" || char === ".") continue;
          if (/\s/.test(char)) {
            if (previousWasSpace) continue;
            previousWasSpace = true;
            chars.push(" ");
            mapToRawIndex.push(i);
            continue;
          }
          previousWasSpace = false;
          chars.push(char.toLowerCase());
          mapToRawIndex.push(i);
        }
        const normalizedText = chars.join("").trim();
        if (!normalizedText) return -1;
        const startInNormalized = normalizedText.indexOf(needle);
        if (
          startInNormalized < 0 ||
          startInNormalized >= mapToRawIndex.length
        ) {
          return -1;
        }
        return mapToRawIndex[startInNormalized];
      };

      const findNodeAndOffset = (needle: string) => {
        if (!needle) return undefined;
        for (const node of textNodes) {
          const raw = node.nodeValue || "";
          let index = raw.toLowerCase().indexOf(needle);
          if (index < 0) {
            index = findOffsetWithWhitespaceNormalization(raw, needle);
          }
          if (index >= 0) {
            return { node, offset: index };
          }
        }
        return undefined;
      };

      const preferredMatch = findNodeAndOffset(normalizedPreferred);
      const fallbackMatch = fallbackTerm
        ? findNodeAndOffset(fallbackTerm)
        : undefined;
      const target = preferredMatch || fallbackMatch;
      if (!target) return undefined;

      const range = document.createRange();
      range.setStart(target.node, target.offset);
      range.collapse(true);
      const marker = document.createElement("span");
      marker.dataset.searchScrollAnchor = "1";
      marker.className = "inline-block h-0 w-0";
      range.insertNode(marker);
      return marker;
    };

    const triggerManualExpand = (summary: HTMLElement) => {
      const details = summary.closest("details");
      if (!(details instanceof HTMLDetailsElement)) return;
      if (details.hasAttribute("open")) return;
      summary.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    };

    const findQuestionSummary = (from: HTMLElement) => {
      const owningDetails = from.closest("details");
      if (!owningDetails) return undefined;
      return Array.from(owningDetails.children).find(
        (child) => child.tagName === "SUMMARY",
      ) as HTMLElement | undefined;
    };

    const findSectionHeader = (from: HTMLElement) =>
      from.closest("summary, h1, h2, h3, h4, h5, h6") as HTMLElement | null;

    const scrollToMatch = (behavior: ScrollBehavior) => {
      // Always use header height — it's rendered at full size even when
      // hidden (opacity-0), and will become visible after scrolling.
      const headerH =
        stickyHeaderRef?.offsetHeight || stickyHeaderHeight() || 0;

      // If the match is inside an open <details> with a sticky <summary>,
      // we need to clear that too — it stacks below the page header.
      const openSummaries = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".handbook-content details[open] > summary",
        ),
      );
      const owningOpenSummary =
        openSummaries.find((summary) =>
          summary.parentElement?.contains(match),
        ) || null;
      const summaryStyles = owningOpenSummary
        ? window.getComputedStyle(owningOpenSummary)
        : null;
      const summaryH =
        owningOpenSummary && summaryStyles?.position === "sticky"
          ? owningOpenSummary.getBoundingClientRect().height
          : 0;

      const coveredTop = headerH + summaryH;
      const sectionHeader = findSectionHeader(match);
      const targetEl = sectionHeader || inlineScrollAnchor || match;
      const targetTop =
        targetEl.getBoundingClientRect().top +
        (window.scrollY || window.pageYOffset || 0);

      if (sectionHeader) {
        // For header matches, scroll a bit past the header so it enters its sticky state.
        const sectionHeight = Math.max(
          1,
          sectionHeader.getBoundingClientRect().height ||
            sectionHeader.offsetHeight ||
            24,
        );
        const stickyNudge = 2;
        const destination =
          targetTop + sectionHeight - coveredTop + stickyNudge;
        window.scrollTo({ top: Math.max(0, destination), behavior });
        return;
      }

      const anchorTopOffset = 28;
      const destination = targetTop - coveredTop - anchorTopOffset;
      window.scrollTo({ top: Math.max(0, destination), behavior });
    };

    // Expand matched Q/A if needed, then scroll to exact paragraph and correct once.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearKeywordHighlight?.();
        inlineScrollAnchor?.remove();
        inlineScrollAnchor = undefined;
        if (targetKind === "line") {
          inlineScrollAnchor = createInlineScrollAnchor(
            match,
            targetText,
            query,
          );
        }
        clearKeywordHighlight =
          highlightTerms.length > 0 ? applyKeywordHighlight(match) : undefined;

        const questionSummary = findQuestionSummary(match);
        const willExpand =
          !!questionSummary &&
          !questionSummary.closest("details")?.hasAttribute("open");
        if (questionSummary) {
          triggerManualExpand(questionSummary);
        }
        mainScrollTimer = window.setTimeout(
          () => {
            scrollToMatch("smooth");
          },
          willExpand ? 1000 : 500,
        );

        clearHighlightTimer = window.setTimeout(() => {
          clearKeywordHighlight?.();
          clearKeywordHighlight = undefined;
        }, 2200);

        appliedSearchJumpKey = jumpKey;
      });
    });

    onCleanup(() => {
      if (mainScrollTimer !== undefined) window.clearTimeout(mainScrollTimer);
      if (correctionTimer !== undefined) window.clearTimeout(correctionTimer);
      if (clearHighlightTimer !== undefined) {
        window.clearTimeout(clearHighlightTimer);
      }
      inlineScrollAnchor?.remove();
      inlineScrollAnchor = undefined;
      clearKeywordHighlight?.();
    });
  });

  return (
    <PageShell>
      <Show
        when={!loading()}
        fallback={
          <div class="flex min-h-dvh items-center justify-center px-4">
            <LoadingState label="Loading handbook..." class="text-gray-500" />
          </div>
        }
      >
        <Show
          when={!error() && entry()}
          fallback={
            <div class="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center text-base text-gray-600">
              <p>{error()}</p>
              <button
                type="button"
                onClick={handleBack}
                class="cursor-pointer rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
            </div>
          }
        >
          <div class="relative">
            <div class="relative h-56 w-full overflow-hidden md:h-72">
              <Show when={entry()?.imageUrl}>
                <AuthenticatedImage
                  src={entry()!.imageUrl}
                  alt={entry()!.category || "Handbook category"}
                  class="absolute inset-0 h-full w-full object-cover"
                />
              </Show>
              <div
                class="absolute inset-0 overflow-hidden bg-linear-to-br from-primary-950 via-primary-800 to-secondary-700"
                classList={{ "opacity-45": !!entry()?.imageUrl }}
              >
                <div class="absolute -left-16 top-10 h-56 w-56 rounded-full bg-secondary-300/20 blur-3xl sm:h-72 sm:w-72" />
                <div class="absolute right-[-3rem] top-1/4 h-64 w-64 rounded-full bg-white/12 blur-3xl sm:h-80 sm:w-80" />
                <div class="absolute bottom-[-4rem] left-1/3 h-72 w-72 rounded-full bg-secondary-200/12 blur-3xl sm:h-96 sm:w-96" />
              </div>
              <div class="absolute inset-0 bg-primary/40 mix-blend-multiply" />
              <div class="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-transparent" />
              <div class="absolute inset-0">
                <div class="mx-auto flex h-full max-w-7xl flex-col px-4 pt-4 pb-5 md:pt-5 md:pb-6">
                  <div class="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={handleBack}
                      class="cursor-pointer flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-primary-700/35 text-white shadow-lg backdrop-blur-md transition hover:bg-primary-700/50"
                      aria-label="Back"
                    >
                      <TbOutlineArrowLeft class="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={openCategorySearch}
                      class="cursor-pointer flex h-10 w-48 shrink-0 items-center gap-2 rounded-full border border-white/20 bg-primary-700/35 px-4 text-left text-sm font-medium text-white shadow-lg backdrop-blur-md transition hover:bg-primary-700/50 sm:w-60"
                      aria-label="Search this category"
                    >
                      <TbOutlineSearch class="h-4 w-4 shrink-0 text-white/80" />
                      <span class="truncate">Search this category</span>
                    </button>
                  </div>
                  <div class="mt-auto">
                    <h1 class="text-4xl font-semibold text-white drop-shadow-[0_3px_6px_rgba(0,0,0,0.55)]">
                      {entry()?.category || "Handbook"}
                    </h1>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            class="mx-auto max-w-7xl px-4"
            style={{ "padding-bottom": `${contentBottomPaddingPx()}px` }}
          >
            <div ref={stickySentinelRef} class="h-px w-full" />
            <div class="sticky top-0 z-20 h-0">
              <Show when={hasSectionHeadings()}>
                <div
                  data-handbook-sticky-header="true"
                  ref={stickyHeaderRef}
                  class="absolute left-0 right-0 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur transition-all duration-200"
                  classList={{
                    "pointer-events-none opacity-0 -translate-y-2":
                      !showStickyHeader(),
                    "pointer-events-auto opacity-100 translate-y-0":
                      showStickyHeader(),
                  }}
                >
                  <div class="relative" ref={setSectionMenuRoot}>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleBack}
                        class="cursor-pointer items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
                        aria-label="Back"
                      >
                        <TbOutlineArrowLeft class="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-center justify-between gap-1 text-left"
                        onClick={(event) => {
                          event.stopPropagation();
                          setShowSectionMenu(!showSectionMenu());
                        }}
                      >
                        <h2 class="text-base font-semibold text-gray-900">
                          {currentSection() || "Sections"}
                        </h2>
                        <span
                          class="text-sm text-primary-700"
                          aria-label="Sections"
                        >
                          <span
                            aria-hidden="true"
                            class="inline-block transition-transform duration-200"
                            classList={{ "rotate-180": showSectionMenu() }}
                          >
                            ▾
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <Show when={showSectionMenu() && sectionList().length > 0}>
                    <div class="handbook-section-menu">
                      <For each={sectionList()}>
                        {(section) => (
                          <button
                            type="button"
                            class="handbook-section-item"
                            onClick={() => scrollToSection(section.id)}
                          >
                            {section.title}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={fileOpenError()}>
              <div class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {fileOpenError()}
              </div>
            </Show>
            <Show
              when={entry()?.content}
              fallback={
                <p class="text-base text-gray-500">
                  No content has been added to this handbook category yet.
                </p>
              }
            >
              <div
                class="handbook-content text-base leading-relaxed text-gray-700"
                style={{
                  "--handbook-category-sticky-top": showStickyHeader()
                    ? `${stickyHeaderHeight()}px`
                    : "0px",
                }}
                ref={setContentEl}
                innerHTML={entry()?.content || ""}
              />
            </Show>
          </div>
        </Show>
      </Show>

      <Show when={showSearchFab()}>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={openCategorySearch}
          class="fixed right-4 bottom-4 z-50 h-11 w-11 rounded-full p-0 shadow-lg"
          aria-label="Search this category"
        >
          <TbOutlineSearch class="h-5 w-5" />
        </Button>
      </Show>
    </PageShell>
  );
};

export default HandbookView;
