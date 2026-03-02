import { Component, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { createConfirm } from "../../../components/ui";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import imageCompressor from "quill-image-compress";

import { DetailsBlot } from "./quillDetailsBlot";
import {
  fetchHandbookFile,
  deleteHandbookFileById,
  deleteHandbookFileByPath,
  isHandbookApiFileUrl,
  uploadHandbookFile,
} from "../../../services/handbookFilesService";

Quill.register("modules/imageCompressor", imageCompressor, true);

type HandbookEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onUploadError?: (message: string) => void;
  onUploadStatusChange?: (count: number) => void;
};

const isWhitespaceTextNode = (node: Node | null): node is Text =>
  !!node &&
  node.nodeType === Node.TEXT_NODE &&
  !(node.textContent || "").trim();

const isBlankParagraph = (node: Node | null): node is HTMLParagraphElement => {
  if (!(node instanceof HTMLParagraphElement)) return false;
  const clone = node.cloneNode(true) as HTMLParagraphElement;
  clone.querySelectorAll("br").forEach((br) => br.remove());
  const hasVisibleElements = !!clone.querySelector("*");
  const text = (clone.textContent || "").replace(/\u00a0/g, "").trim();
  return !hasVisibleElements && text === "";
};

const previousNonSpacerSibling = (node: Node | null): Node | null => {
  let current = node?.previousSibling || null;
  while (current) {
    if (isWhitespaceTextNode(current) || isBlankParagraph(current)) {
      current = current.previousSibling;
      continue;
    }
    return current;
  }
  return null;
};

const nextNonSpacerSibling = (node: Node | null): Node | null => {
  let current = node?.nextSibling || null;
  while (current) {
    if (isWhitespaceTextNode(current) || isBlankParagraph(current)) {
      current = current.nextSibling;
      continue;
    }
    return current;
  }
  return null;
};

const removeBlankParagraphsBetweenSections = (
  container: HTMLElement,
  sectionSelector: string,
) => {
  const paragraphs = Array.from(container.querySelectorAll("p"));
  paragraphs.forEach((paragraph) => {
    if (!paragraph.isConnected || !isBlankParagraph(paragraph)) return;
    const prev = previousNonSpacerSibling(paragraph);
    const next = nextNonSpacerSibling(paragraph);
    if (
      prev instanceof HTMLElement &&
      next instanceof HTMLElement &&
      prev.matches(sectionSelector) &&
      next.matches(sectionSelector)
    ) {
      paragraph.remove();
    }
  });
};

/** Convert <details><summary>Q</summary>A</details> → embed divs for Quill */
function detailsHtmlToEmbeds(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("details").forEach((details) => {
    const summary = details.querySelector("summary");
    const summaryHtml = summary?.innerHTML || "";
    const isOpen = details.hasAttribute("open");
    summary?.remove();
    const content = details.innerHTML.trim();

    const embed = document.createElement("div");
    embed.className = "ql-details-block";
    embed.setAttribute("contenteditable", "false");
    embed.dataset.summary = summaryHtml;
    embed.dataset.content = content;
    embed.dataset.collapsed = isOpen ? "false" : "true";
    if (!isOpen) embed.classList.add("is-collapsed");
    DetailsBlot.renderPreview(embed as HTMLDivElement, {
      summary: summaryHtml,
      content,
      collapsed: !isOpen,
    });
    details.replaceWith(embed);
  });
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const source = (img.getAttribute("src") || "").trim();
    if (!isHandbookApiFileUrl(source)) return;
    img.setAttribute(HANDBOOK_IMAGE_SOURCE_ATTR, source);
    img.removeAttribute("src");
  });
  removeBlankParagraphsBetweenSections(container, ".ql-details-block");
  return container.innerHTML;
}

/** Convert embed divs → <details><summary>Q</summary>A</details> for storage */
function embedsToDetailsHtml(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll(".ql-details-block").forEach((el) => {
    const node = el as HTMLElement;
    const summaryEl = node.querySelector(".ql-details-summary") as HTMLElement | null;
    const contentEl = node.querySelector(".ql-details-content") as HTMLElement | null;
    const summary = summaryEl?.innerHTML || node.dataset.summary || "";
    const content = contentEl?.innerHTML || node.dataset.content || "";
    const isCollapsed =
      node.dataset.collapsed === "true" ||
      node.classList.contains("is-collapsed");

    const details = document.createElement("details");
    if (!isCollapsed) details.setAttribute("open", "");
    const summaryNode = document.createElement("summary");
    summaryNode.innerHTML = summary;
    details.appendChild(summaryNode);

    const temp = document.createElement("div");
    temp.innerHTML = content;
    while (temp.firstChild) details.appendChild(temp.firstChild);

    el.replaceWith(details);
  });
  removeBlankParagraphsBetweenSections(container, "details");
  return container.innerHTML;
}

const HANDBOOK_IMAGE_SOURCE_ATTR = "data-handbook-source-url";

const getPersistedImageSource = (img: HTMLImageElement): string =>
  (
    img.getAttribute(HANDBOOK_IMAGE_SOURCE_ATTR)
    || img.getAttribute("src")
    || ""
  ).trim();

const buildPersistedEditorHtml = (root: HTMLElement): string => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const source = getPersistedImageSource(img);
    if (source) {
      img.setAttribute("src", source);
    } else {
      img.removeAttribute("src");
    }
    img.removeAttribute(HANDBOOK_IMAGE_SOURCE_ATTR);
  });

  return clone.innerHTML || "";
};

export const HandbookEditor: Component<HandbookEditorProps> = (props) => {
  const [DeleteQAModal, confirmDeleteQA] = createConfirm({
    title: "Delete Q&A section",
    message: "Delete this Q&A section?",
    confirmLabel: "Delete",
    variant: "danger",
  });

  let containerRef: HTMLDivElement | undefined;
  let editorRef: HTMLDivElement | undefined;
  let quillInstance: Quill | undefined;
  let isInternalUpdate = false;
  let currentDetailsHtml = "";
  let cleanupMainMediaHandlers: (() => void) | undefined;
  let cleanupAnswerMediaHandlers: (() => void) | undefined;
  let cleanupToolbarFocusGuard: (() => void) | undefined;
  let cleanupToolbarMetrics: (() => void) | undefined;
  let knownMediaPaths = new Set<string>();
  let lastAppliedHtml = "";
  let pendingEmitFrame: number | null = null;
  let lastDetailsSelection: Range | null = null;
  let lastDetailsEditable: HTMLElement | null = null;
  let lastDetailsSelectionAt = 0;
  const [uploadingCount, setUploadingCount] = createSignal(0);
  const editorImagePreviewUrls = new Map<HTMLImageElement, string>();

  const revokeProtectedImagePreview = (img: HTMLImageElement) => {
    const objectUrl = editorImagePreviewUrls.get(img);
    if (
      objectUrl
      && typeof window !== "undefined"
      && typeof window.URL?.revokeObjectURL === "function"
    ) {
      window.URL.revokeObjectURL(objectUrl);
    }
    editorImagePreviewUrls.delete(img);
  };

  const syncProtectedImagePreviews = (root: HTMLElement) => {
    if (
      typeof window === "undefined"
      || typeof window.URL?.createObjectURL !== "function"
    ) {
      return;
    }

    const liveImages = new Set(root.querySelectorAll<HTMLImageElement>("img"));

    Array.from(editorImagePreviewUrls.keys()).forEach((img) => {
      if (liveImages.has(img) && img.isConnected) {
        return;
      }
      revokeProtectedImagePreview(img);
    });

    liveImages.forEach((img) => {
      const source = getPersistedImageSource(img);

      if (!source || !isHandbookApiFileUrl(source)) {
        img.removeAttribute(HANDBOOK_IMAGE_SOURCE_ATTR);
        revokeProtectedImagePreview(img);
        return;
      }

      const trackedSource =
        (img.getAttribute(HANDBOOK_IMAGE_SOURCE_ATTR) || "").trim();
      if (trackedSource === source && editorImagePreviewUrls.has(img)) {
        return;
      }

      img.setAttribute(HANDBOOK_IMAGE_SOURCE_ATTR, source);
      revokeProtectedImagePreview(img);

      void (async () => {
        try {
          const response = await fetchHandbookFile(source);
          if (!response.ok) {
            throw new Error(`Unable to load image (${response.status})`);
          }

          const blob = await response.blob();
          const latestSource = getPersistedImageSource(img);
          if (!img.isConnected || latestSource !== source) {
            return;
          }

          const objectUrl = window.URL.createObjectURL(blob);
          revokeProtectedImagePreview(img);
          editorImagePreviewUrls.set(img, objectUrl);
          img.src = objectUrl;
        } catch {
          // Leave the persisted source intact for save/emit and keep the
          // editor image unresolved if the authenticated fetch fails.
        }
      })();
    });
  };

  /** Temporarily disconnect Quill's MutationObserver so DOM changes inside
   *  answer blocks don't get intercepted and moved outside the embed. */
  const muteQuillObserver = (fn: () => void) => {
    const scroll = (quillInstance as any)?.scroll;
    const observer: MutationObserver | undefined = scroll?.observer;
    observer?.disconnect();
    try {
      fn();
    } finally {
      if (observer && scroll?.domNode) {
        observer.observe(scroll.domNode, {
          attributes: true,
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        });
      }
    }
  };
  const pendingDeletes = new Set<string>();
  const handleUploadError = (message: string) => {
    props.onUploadError?.(message);
  };

  const getDetailsEditableFromSelection = (): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const anchorNode = sel.anchorNode;
    if (!anchorNode) return null;
    const anchorEl =
      anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    return (
      (anchorEl?.closest?.(
        ".ql-details-summary, .ql-details-content",
      ) as HTMLElement | null) || null
    );
  };

  const resolveDetailsFormattingTarget = (quill: Quill): HTMLElement | null => {
    const active = document.activeElement as HTMLElement | null;
    const activeDetails = active?.closest?.(
      ".ql-details-summary, .ql-details-content",
    ) as HTMLElement | null;
    if (activeDetails) return activeDetails;

    const selectionDetails = getDetailsEditableFromSelection();
    if (selectionDetails) return selectionDetails;

    // If normal editor (outside Q&A) is actively focused with a Quill range,
    // formatting should target Quill instead of remembered Q&A selection.
    const activeInEditor =
      !!active &&
      quill.root.contains(active) &&
      !active.closest(".ql-details-block");
    const quillRange = quill.getSelection();
    if (activeInEditor && quillRange) return null;

    if (
      lastDetailsEditable &&
      containerRef?.contains(lastDetailsEditable) &&
      lastDetailsSelection &&
      Date.now() - lastDetailsSelectionAt < 2000
    ) {
      return lastDetailsEditable;
    }

    return null;
  };

  const updateDetailsToolbarActive = (quill: Quill) => {
    const toolbar = quill.getModule("toolbar") as
      | { container?: HTMLElement }
      | undefined;
    const container = toolbar?.container;
    if (!container) return;
    const target = resolveDetailsFormattingTarget(quill);
    if (!target) return;

    const setActive = (name: "bold" | "italic" | "underline", active: boolean) => {
      const button = container.querySelector(
        `button.ql-${name}`,
      ) as HTMLButtonElement | null;
      if (!button) return;
      button.classList.toggle("ql-active", active);
    };

    setActive("bold", document.queryCommandState("bold"));
    setActive("italic", document.queryCommandState("italic"));
    setActive("underline", document.queryCommandState("underline"));
  };

  const updateToolbarAvailability = (
    quill: Quill,
    detailsTarget: HTMLElement | null,
  ) => {
    const toolbar = quill.getModule("toolbar") as
      | { container?: HTMLElement }
      | undefined;
    const container = toolbar?.container;
    if (!container) return;

    const inQuestion = !!detailsTarget?.classList.contains("ql-details-summary");
    const allowed = new Set(["undo", "redo", "bold", "italic", "underline"]);

    const toggleButton = (btn: HTMLButtonElement) => {
      const qlClass = Array.from(btn.classList).find((c) => c.startsWith("ql-"));
      if (!qlClass) return;
      const name = qlClass.replace(/^ql-/, "");
      const disabled = inQuestion && !allowed.has(name);
      btn.disabled = disabled;
      btn.classList.toggle("is-disabled", disabled);
      if (disabled) btn.blur();
    };

    container.querySelectorAll("button").forEach((node) => {
      toggleButton(node as HTMLButtonElement);
    });

    const headerPicker = container.querySelector(".ql-header") as HTMLElement | null;
    if (headerPicker) {
      const disabled = inQuestion;
      headerPicker.classList.toggle("is-disabled", disabled);
      headerPicker.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
  };

  const insertFileIntoEditor = (
    file: {
      url: string;
      name: string;
      contentType: string;
    },
    mode: "embed" | "link" = "embed",
  ) => {
    if (!quillInstance) return;
    const range = quillInstance.getSelection(true) || {
      index: quillInstance.getLength(),
      length: 0,
    };
    const displayName = file.name
      ? file.name.replace(/\.[^/.]+$/i, "")
      : "";
    if (file.contentType.startsWith("image/")) {
      if (mode === "link") {
        quillInstance.insertText(
          range.index,
          displayName || file.url,
          "link",
          file.url,
          Quill.sources.USER,
        );
        quillInstance.insertText(
          range.index + (displayName || file.url).length,
          " ",
          Quill.sources.USER,
        );
        quillInstance.setSelection(
          range.index + (displayName || file.url).length + 1,
          0,
          Quill.sources.USER,
        );
        return;
      }
      quillInstance.insertEmbed(range.index, "image", file.url, Quill.sources.USER);
      quillInstance.insertText(range.index + 1, "\n", Quill.sources.USER);
      quillInstance.setSelection(range.index + 2, 0, Quill.sources.USER);
      requestAnimationFrame(() => {
        if (quillInstance?.root) {
          syncProtectedImagePreviews(quillInstance.root);
        }
      });
      return;
    }
    if (file.contentType.startsWith("video/")) {
      if (mode === "embed") {
        quillInstance.insertEmbed(range.index, "video", file.url, Quill.sources.USER);
        quillInstance.insertText(range.index + 1, "\n", Quill.sources.USER);
        quillInstance.setSelection(range.index + 2, 0, Quill.sources.USER);
        return;
      }
      quillInstance.insertText(
        range.index,
        displayName || file.url,
        "link",
        file.url,
        Quill.sources.USER,
      );
      quillInstance.insertText(
        range.index + (displayName || file.url).length,
        " ",
        Quill.sources.USER,
      );
      quillInstance.setSelection(
        range.index + (displayName || file.url).length + 1,
        0,
        Quill.sources.USER,
      );
      return;
    }
    quillInstance.insertText(
      range.index,
      displayName || file.url,
      "link",
      file.url,
      Quill.sources.USER,
    );
    quillInstance.insertText(range.index + (displayName || file.url).length, " ", Quill.sources.USER);
    quillInstance.setSelection(range.index + (displayName || file.url).length + 1, 0, Quill.sources.USER);
  };

  const restoreDetailsSelection = (target: HTMLElement) => {
    target.focus();
    if (!lastDetailsSelection) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(lastDetailsSelection.cloneRange());
  };

  const syncDetailsSelectionSnapshot = (target?: HTMLElement | null) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (target) lastDetailsEditable = target;
    lastDetailsSelection = sel.getRangeAt(0).cloneRange();
  };

  const resolveLiveAnswerTarget = (
    quill: Quill,
    preferred: HTMLElement,
    blockIndexHint: number,
  ): HTMLElement | null => {
    if (
      preferred.isConnected &&
      preferred.classList.contains("ql-details-content")
    ) {
      return preferred;
    }
    if (blockIndexHint >= 0) {
      const liveBlock = Array.from(
        quill.root.querySelectorAll<HTMLElement>(".ql-details-block"),
      )[blockIndexHint];
      const liveAnswer = liveBlock?.querySelector(
        ".ql-details-content",
      ) as HTMLElement | null;
      if (liveAnswer) return liveAnswer;
    }
    const resolved = resolveDetailsFormattingTarget(quill);
    if (resolved?.classList.contains("ql-details-content")) return resolved;
    return null;
  };

  const getInsertionRangeInAnswer = (answerEl: HTMLElement): Range => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const current = sel.getRangeAt(0);
      if (answerEl.contains(current.commonAncestorContainer)) return current;
    }
    const range = document.createRange();
    range.selectNodeContents(answerEl);
    range.collapse(false);
    return range;
  };

  const extractLegacyStoragePath = (url: string): string => {
    try {
      const match = url.match(/\/o\/([^?]+)/);
      if (!match) return "";
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  };

  const extractApiFileId = (url: string): number | null => {
    try {
      const parsed = new URL(url, window.location.origin);
      const match = parsed.pathname.match(/\/api\/handbook\/file\/(\d+)$/);
      if (!match) return null;
      const id = Number(match[1]);
      return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  };

  const extractMediaRef = (url: string): string => {
    const fileId = extractApiFileId(url);
    if (fileId) return `id:${fileId}`;
    const legacyPath = extractLegacyStoragePath(url);
    if (legacyPath) return `path:${legacyPath}`;
    return "";
  };

  const uploadToHandbookStorage = async (file: File) => {
    const uploaded = await uploadHandbookFile(file);
    return { filePath: uploaded.path, fileUrl: uploaded.url };
  };

  const collectMediaPaths = (root: HTMLElement) => {
    const paths = new Set<string>();
    root.querySelectorAll("img").forEach((img) => {
      const src = getPersistedImageSource(img);
      if (!src || src.startsWith("data:")) return;
      const mediaRef = extractMediaRef(src);
      if (mediaRef) paths.add(mediaRef);
    });
    root.querySelectorAll("a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("data:")) return;
      const mediaRef = extractMediaRef(href);
      if (mediaRef) paths.add(mediaRef);
    });
    return paths;
  };

  const deleteMediaPath = async (fileRef: string) => {
    if (!fileRef || pendingDeletes.has(fileRef)) return;
    pendingDeletes.add(fileRef);
    try {
      if (fileRef.startsWith("id:")) {
        const id = Number(fileRef.slice(3));
        if (Number.isFinite(id) && id > 0) {
          await deleteHandbookFileById(id);
        }
        return;
      }
      if (fileRef.startsWith("path:")) {
        const path = fileRef.slice(5);
        if (path) {
          await deleteHandbookFileByPath(path);
        }
      }
    } catch (err) {
      console.warn("Failed to delete handbook file", err);
    } finally {
      pendingDeletes.delete(fileRef);
    }
  };

  const reconcileMediaPaths = (root: HTMLElement) => {
    const nextPaths = collectMediaPaths(root);
    const removed = Array.from(knownMediaPaths).filter(
      (path) => !nextPaths.has(path),
    );
    removed.forEach((path) => void deleteMediaPath(path));
    knownMediaPaths = nextPaths;
  };

  const uploadFileToEditor = async (
    quill: Quill,
    file: File,
    mode: "embed" | "link" = "embed",
  ) => {
    setUploadingCount((value) => value + 1);
    try {
      if (file.type.startsWith("video/")) {
        const result = await uploadToHandbookStorage(file);
        insertFileIntoEditor(
          {
            url: result.fileUrl,
            name: file.name,
            contentType: file.type,
          },
          mode,
        );
        return;
      }
      const result = await uploadToHandbookStorage(file);
      insertFileIntoEditor(
        {
          url: result.fileUrl,
          name: file.name,
          contentType: file.type,
        },
        mode,
      );
    } finally {
      setUploadingCount((value) => Math.max(0, value - 1));
    }
  };

  const uploadFileForDetails = async (file: File) => {
    setUploadingCount((value) => value + 1);
    try {
      if (file.type.startsWith("video/")) {
        const result = await uploadToHandbookStorage(file);
        return {
          url: result.fileUrl,
          name: file.name,
          contentType: file.type,
        };
      }
      const result = await uploadToHandbookStorage(file);
      return {
        url: result.fileUrl,
        name: file.name,
        contentType: file.type,
      };
    } finally {
      setUploadingCount((value) => Math.max(0, value - 1));
    }
  };

  const attachMediaHandlers = (quill: Quill) => {
    const handlePaste = async (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return;
      const file = files.find((candidate) =>
        candidate.type.startsWith("image/") ||
        candidate.type.startsWith("video/") ||
        candidate.type === "application/pdf",
      );
      if (!file) return;
      event.preventDefault();
      try {
        await uploadFileToEditor(quill, file);
      } catch (err) {
        console.error("Failed to upload pasted media", err);
        handleUploadError("Unable to upload pasted file.");
      }
    };
    const handleDrop = async (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      const file = files.find((candidate) =>
        candidate.type.startsWith("image/") ||
        candidate.type.startsWith("video/") ||
        candidate.type === "application/pdf",
      );
      if (!file) return;
      event.preventDefault();
      try {
        await uploadFileToEditor(quill, file);
      } catch (err) {
        console.error("Failed to upload dropped media", err);
        handleUploadError("Unable to upload dropped file.");
      }
    };
    const root = quill.root;
    root.addEventListener("paste", handlePaste);
    root.addEventListener("drop", handleDrop);
    root.addEventListener("dragover", (event) => event.preventDefault());
    return () => {
      root.removeEventListener("paste", handlePaste);
      root.removeEventListener("drop", handleDrop);
    };
  };

  const openMediaPicker = (quill: Quill) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await uploadFileToEditor(quill, file);
      } catch (err) {
        console.error("Failed to upload media", err);
        handleUploadError("Unable to upload file.");
      }
    };
    input.click();
  };

  const openAttachmentPicker = (quill: Quill) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,video/*,image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await uploadFileToEditor(quill, file, "link");
      } catch (err) {
        console.error("Failed to upload attachment", err);
        handleUploadError("Unable to upload attachment.");
      }
    };
    input.click();
  };

  const attachToolbarFocusGuard = (quill: Quill) => {
    const toolbar = quill.getModule("toolbar") as
      | { container?: HTMLElement }
      | undefined;
    const container = toolbar?.container;
    if (!container) return undefined;

    const keepDetailsFocus = (event: Event) => {
      const targetEl = event.target as HTMLElement | null;
      const button = targetEl?.closest?.("button") as HTMLButtonElement | null;
      if (!button) return;
      const detailsTarget = resolveDetailsFormattingTarget(quill);
      if (!detailsTarget) return;
      // Prevent toolbar button focus from stealing selection from Q&A editable region.
      event.preventDefault();
      event.stopPropagation();
      restoreDetailsSelection(detailsTarget);
    };

    container.addEventListener("mousedown", keepDetailsFocus, true);
    container.addEventListener("touchstart", keepDetailsFocus, true);
    return () => {
      container.removeEventListener("mousedown", keepDetailsFocus, true);
      container.removeEventListener("touchstart", keepDetailsFocus, true);
    };
  };

  const setupToolbarMetrics = () => {
    const toolbar = containerRef?.querySelector(".ql-toolbar") as HTMLElement | null;
    if (!toolbar || !containerRef) return undefined;

    const syncToolbarHeight = () => {
      const height = Math.ceil(toolbar.getBoundingClientRect().height);
      containerRef?.style.setProperty("--handbook-editor-toolbar-height", `${height}px`);
    };

    syncToolbarHeight();
    const resizeObserver = new ResizeObserver(syncToolbarHeight);
    resizeObserver.observe(toolbar);
    window.addEventListener("resize", syncToolbarHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncToolbarHeight);
    };
  };

  const setupDetailsHandlers = (quill: Quill) => {
    const focusQuestionStart = (summaryEl: HTMLElement) => {
      requestAnimationFrame(() => {
        if (!summaryEl.isConnected) return;
        summaryEl.focus();
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(summaryEl);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        lastDetailsEditable = summaryEl;
        lastDetailsSelection = range.cloneRange();
        lastDetailsSelectionAt = Date.now();
      });
    };

    const focusSummaryEnd = (summaryEl: HTMLElement) => {
      summaryEl.focus();
      const sel = window.getSelection();
      if (!sel) return;
      sel.selectAllChildren(summaryEl);
      sel.collapseToEnd();
      lastDetailsEditable = summaryEl;
    };

    const isVisuallyEmptyLine = (
      lineEl: HTMLElement | null,
      fallbackEl: HTMLElement,
    ) => {
      const text = (lineEl?.textContent || "")
        .replace(/\u200B/g, "")
        .replace(/\u00A0/g, " ")
        .trim();
      if (text.length > 0) return false;

      const html = (lineEl?.innerHTML || fallbackEl.innerHTML || "")
        .replace(/<br\s*\/?>/gi, "")
        .replace(/&nbsp;/gi, "")
        .replace(/\u00A0/g, "")
        .replace(/\u200B/g, "")
        .replace(/<\/?span[^>]*>/gi, "")
        .replace(/\s+/g, "")
        .trim();

      return html.length === 0;
    };

    const isCaretAtStart = (el: HTMLElement) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return false;
      const before = range.cloneRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      const text = (before.cloneContents().textContent || "")
        .replace(/\u200B/g, "")
        .trim();
      return text.length === 0;
    };

    const isCaretAtEnd = (el: HTMLElement) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return false;
      const after = range.cloneRange();
      after.selectNodeContents(el);
      after.setStart(range.startContainer, range.startOffset);
      const text = (after.cloneContents().textContent || "")
        .replace(/\u200B/g, "")
        .trim();
      return text.length === 0;
    };

    const getCurrentLineElement = (scopeEl: HTMLElement): HTMLElement | null => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const startEl =
        startNode instanceof Element ? startNode : startNode.parentElement;
      if (!startEl || !scopeEl.contains(startEl)) return null;
      return (
        startEl.closest(
          "p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,div",
        ) as HTMLElement | null
      );
    };

    const findPreviousDetailsEmbedIndex = (startIndex: number) => {
      let i = Math.max(0, startIndex - 1);
      while (i >= 0) {
        const delta = quill.getContents(i, 1);
        const op = delta.ops?.[0];
        if (!op) return null;
        if (typeof op.insert === "object") {
          if ("details-block" in (op.insert as Record<string, unknown>)) {
            return i;
          }
          return null;
        }
        const text = String(op.insert || "");
        if (text === "\n") {
          i -= 1;
          continue;
        }
        // Any non-newline text means we reached normal content.
        return null;
      }
      return null;
    };

    const scrollSummaryIntoView = (summaryEl: HTMLElement) => {
      const scrollHost = summaryEl.closest(
        "[data-handbook-editor-scroll-host='true']",
      ) as HTMLElement | null;
      if (!scrollHost) {
        summaryEl.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const stickyTop = parseFloat(getComputedStyle(summaryEl).top || "0") || 0;
      const extraLift = 50;
      const hostRect = scrollHost.getBoundingClientRect();
      const summaryRect = summaryEl.getBoundingClientRect();
      const summaryTopInHost =
        summaryRect.top - hostRect.top + scrollHost.scrollTop;
      const destination = Math.max(0, summaryTopInHost - stickyTop - extraLift);
      scrollHost.scrollTo({ top: destination, behavior: "smooth" });
    };

    const isDetailsEmbedAt = (index: number) => {
      if (index < 0) return false;
      const delta = quill.getContents(index, 1);
      const op = delta.ops?.[0];
      return (
        !!op?.insert &&
        typeof op.insert === "object" &&
        "details-block" in (op.insert as Record<string, unknown>)
      );
    };

    const isWhitespaceOnlyLine = (line: any) => {
      if (!line) return false;
      const lineIndex = quill.getIndex(line);
      const contentLength = Math.max(0, line.length() - 1); // exclude trailing newline
      const raw = quill.getText(lineIndex, contentLength);
      const normalized = raw.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
      return normalized.trim().length === 0;
    };

    const syncDetailsSelection = () => {
      const sel = window.getSelection();
      const detailsEditable = getDetailsEditableFromSelection();
      updateToolbarAvailability(quill, detailsEditable);
      if (!detailsEditable) return;
      lastDetailsEditable = detailsEditable;
      if (sel && sel.rangeCount > 0) {
        lastDetailsSelection = sel.getRangeAt(0).cloneRange();
        lastDetailsSelectionAt = Date.now();
      }
      updateDetailsToolbarActive(quill);
    };

    // Stop Quill from overriding cursor placement inside editable areas.
    // Must intercept mousedown (not click) since Quill sets selection on mousedown.
    const handleMousedown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const block = target.closest?.(".ql-details-block") as HTMLElement | null;
      if (!block) return;
      e.stopPropagation();
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      const detailsEditable = target?.closest?.(
        ".ql-details-summary, .ql-details-content",
      ) as HTMLElement | null;
      if (!detailsEditable) return;
      lastDetailsEditable = detailsEditable;
      syncDetailsSelection();
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const summary = target.closest?.(".ql-details-summary");
      if (!summary) return;
      const block = summary.closest(".ql-details-block") as HTMLElement | null;
      if (!block) return;
      // Chevron click — toggle collapse
      const rect = summary.getBoundingClientRect();
      if (e.clientX <= rect.left + 20) {
        const collapsed = block.classList.toggle("is-collapsed");
        block.dataset.collapsed = collapsed ? "true" : "false";
        requestAnimationFrame(() =>
          scrollSummaryIntoView(summary as HTMLElement),
        );
      }
    };

    const handleInput = () => {
      syncProtectedImagePreviews(quill.root);
      // Sync edits from contenteditable children back to data-* attributes
      quill.root.querySelectorAll(".ql-details-block").forEach((el) => {
        const block = el as HTMLElement;
        const summaryEl = block.querySelector(".ql-details-summary");
        const contentEl = block.querySelector(".ql-details-content");
        if (summaryEl) block.dataset.summary = summaryEl.innerHTML || "";
        if (contentEl) block.dataset.content = contentEl.innerHTML || "";
      });
      // Notify parent of change (Quill won't fire text-change for embed edits)
      const html = buildPersistedEditorHtml(quill.root);
      const detailsHtml = embedsToDetailsHtml(html);
      if (detailsHtml !== currentDetailsHtml) {
        currentDetailsHtml = detailsHtml;
        props.onChange(detailsHtml);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const block = target.closest?.(".ql-details-block") as HTMLElement | null;

      // Cursor is outside a Q&A block — check if Backspace/Delete would remove one
      if (!block) {
        if (e.key !== "Backspace" && e.key !== "Delete") return;
        const range = quill.getSelection();
        if (!range || range.length > 0) return;
        const checkIndex = e.key === "Backspace" ? range.index - 1 : range.index;
        if (checkIndex < 0) return;
        const delta = quill.getContents(checkIndex, 1);
        const op = delta.ops?.[0];
        if (op?.insert && typeof op.insert === "object" && "details-block" in (op.insert as Record<string, unknown>)) {
          e.preventDefault();
          e.stopPropagation();
          const restoreIndex = range.index;
          confirmDeleteQA().then((confirmed) => {
            if (confirmed) {
              quill.deleteText(checkIndex, 1, Quill.sources.USER);
            }
            const nextIndex = Math.max(
              0,
              Math.min(restoreIndex, Math.max(0, quill.getLength() - 1)),
            );
            quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
            quill.focus();
          });
        }
        return;
      }

      // Stop Backspace/Delete from reaching Quill (prevents embed deletion)
      if (e.key === "Backspace" || e.key === "Delete") {
        const inSummary = target.closest(".ql-details-summary") as HTMLElement | null;
        const inContent = target.closest(".ql-details-content") as HTMLElement | null;

        if (e.key === "Backspace" && inContent) {
          const summaryEl = block.querySelector(
            ".ql-details-summary",
          ) as HTMLElement | null;
          const currentLineEl = getCurrentLineElement(inContent);

          // If caret is at start of current details line, and previous line is empty,
          // remove that previous empty line but keep caret on current line.
          if (currentLineEl && isCaretAtStart(currentLineEl)) {
            const prevLineEl = currentLineEl.previousElementSibling as
              | HTMLElement
              | null;
            if (prevLineEl && isVisuallyEmptyLine(prevLineEl, prevLineEl)) {
              e.preventDefault();
              e.stopPropagation();
              prevLineEl.remove();
              currentLineEl.focus();
              const sel = window.getSelection();
              if (sel) {
                const range = document.createRange();
                range.selectNodeContents(currentLineEl);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
              }
              lastDetailsEditable = inContent;
              handleInput();
              return;
            }
          }

          if (summaryEl && isCaretAtStart(inContent)) {
            const firstLineEl = inContent.firstElementChild as HTMLElement | null;
            const isFirstLineEmpty = isVisuallyEmptyLine(firstLineEl, inContent);

            if (isFirstLineEmpty) {
              e.preventDefault();
              e.stopPropagation();
              if (firstLineEl) {
                firstLineEl.remove();
              } else {
                inContent.innerHTML = "";
              }
              focusSummaryEnd(summaryEl);
              handleInput();
              return;
            }
          }
        }

        if (e.key === "Backspace" && inSummary) {
          // At start of question: delete previous empty line outside the Q&A block.
          if (isCaretAtStart(inSummary)) {
            const blot = Quill.find(block);
            if (blot) {
              const index = quill.getIndex(blot as any);
              if (index > 0) {
                if (isDetailsEmbedAt(index - 1)) {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmDeleteQA().then((confirmed) => {
                    if (confirmed) {
                      quill.deleteText(index - 1, 1, Quill.sources.USER);
                    }
                    focusQuestionStart(inSummary);
                  });
                  return;
                }

                const [prevLine] = quill.getLine(index - 1);
                if (prevLine) {
                  const prevLineIndex = quill.getIndex(prevLine);
                  if (isWhitespaceOnlyLine(prevLine)) {
                    e.preventDefault();
                    e.stopPropagation();
                    quill.deleteText(
                      prevLineIndex,
                      prevLine.length(),
                      Quill.sources.USER,
                    );
                    focusQuestionStart(inSummary);
                    return;
                  }
                }

                const prevDetailsIndex = findPreviousDetailsEmbedIndex(index);
                if (prevDetailsIndex !== null) {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmDeleteQA().then((confirmed) => {
                    if (confirmed) {
                      quill.deleteText(prevDetailsIndex, 1, Quill.sources.USER);
                    }
                    focusQuestionStart(inSummary);
                  });
                  return;
                }

                if (prevLine) {
                  const prevLineIndex = quill.getIndex(prevLine);
                  // Previous line has content (not blank and not Q&A):
                  // delete last character/embed in that line and place caret there.
                  const contentLen = Math.max(0, prevLine.length() - 1);
                  if (contentLen > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    const deleteIndex = prevLineIndex + contentLen - 1;
                    quill.deleteText(deleteIndex, 1, Quill.sources.USER);
                    quill.setSelection(deleteIndex, 0, Quill.sources.USER);
                    quill.focus();
                    return;
                  }
                }
              }
            }
          }

          const summaryText = (inSummary.textContent || "").trim();
          if (!summaryText) {
            e.preventDefault();
            e.stopPropagation();
            const blot = Quill.find(block);
            if (blot) {
              const index = quill.getIndex(blot as any);
              confirmDeleteQA().then((confirmed) => {
                if (confirmed) {
                  quill.deleteText(index, 1, Quill.sources.USER);
                  const nextIndex = Math.max(
                    0,
                    Math.min(index, Math.max(0, quill.getLength() - 1)),
                  );
                  quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
                  quill.focus();
                  return;
                }
                focusQuestionStart(inSummary);
              });
            }
            return;
          }
        }
        e.stopPropagation();
        return;
      }

      // Enter in summary → new line after the Q&A block; in content → native newline
      if (e.key === "Enter") {
        e.stopPropagation();
        const inSummary = target.closest(".ql-details-summary");
        if (inSummary) {
          e.preventDefault();
          const summaryEl = inSummary as HTMLElement;
          const contentEl = block.querySelector(
            ".ql-details-content",
          ) as HTMLElement | null;
          const isCollapsed =
            block.classList.contains("is-collapsed") ||
            block.dataset.collapsed === "true";

          // Enter at summary end:
          // - expanded: go to first line in details and insert a blank line there
          // - collapsed: insert a blank line after the Q&A block
          if (isCaretAtEnd(summaryEl)) {
            if (!isCollapsed && contentEl) {
              const blank = document.createElement("p");
              blank.appendChild(document.createElement("br"));
              if (contentEl.firstChild) {
                contentEl.insertBefore(blank, contentEl.firstChild);
              } else {
                contentEl.appendChild(blank);
              }
              contentEl.focus();
              const sel = window.getSelection();
              if (sel) {
                const range = document.createRange();
                range.setStart(blank, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
              }
              lastDetailsEditable = contentEl;
              handleInput();
              return;
            }

            const blot = Quill.find(block);
            if (blot) {
              const index = quill.getIndex(blot as any);
              const insertIndex = index + 1;
              quill.insertText(insertIndex, "\n", Quill.sources.USER);
              quill.setSelection(insertIndex + 1, 0, Quill.sources.USER);
              quill.focus();
            }
            return;
          }

          if (isCaretAtStart(inSummary as HTMLElement)) {
            const blot = Quill.find(block);
            if (blot) {
              const index = quill.getIndex(blot as any);
              quill.insertText(index, "\n", Quill.sources.USER);
            }
            focusQuestionStart(inSummary as HTMLElement);
            return;
          }
          const blot = Quill.find(block);
          if (blot) {
            const index = quill.getIndex(blot as any);
            quill.insertText(index, "\n", Quill.sources.USER);
            quill.setSelection(index, 0, Quill.sources.USER);
            quill.focus();
          }
          return;
        }
        // Inside answer content, allow native contenteditable Enter behavior.
        return;
      }

      // Navigate between summary ↔ content ↔ Quill
      const summaryEl = block.querySelector(".ql-details-summary") as HTMLElement | null;
      const contentEl = block.querySelector(".ql-details-content") as HTMLElement | null;
      const inSummary = target.closest(".ql-details-summary");
      const inContent = target.closest(".ql-details-content");

      if (e.key === "Tab") {
        if (inSummary && contentEl) {
          e.preventDefault();
          e.stopPropagation();
          contentEl.focus();
          const sel = window.getSelection();
          if (sel && contentEl.firstChild) {
            sel.collapse(contentEl.firstChild, 0);
          }
          return;
        }
        if (inContent && quill) {
          e.preventDefault();
          e.stopPropagation();
          const blot = Quill.find(block);
          if (blot) {
            const index = quill.getIndex(blot as any) + 1;
            quill.setSelection(index, 0, Quill.sources.USER);
            quill.focus();
          }
          return;
        }
      }

      if (e.key === "ArrowDown") {
        if (inSummary && contentEl) {
          const isCollapsed =
            block.classList.contains("is-collapsed") ||
            block.dataset.collapsed === "true";
          if (isCollapsed && quill) {
            e.preventDefault();
            e.stopPropagation();
            const blot = Quill.find(block);
            if (blot) {
              const index = quill.getIndex(blot as any) + 1;
              quill.setSelection(index, 0, Quill.sources.USER);
              quill.focus();
            }
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          contentEl.focus();
          const sel = window.getSelection();
          if (sel && contentEl.firstChild) {
            sel.collapse(contentEl.firstChild, 0);
          }
          return;
        }
        // Only jump out of answer block if cursor is on the last line
        if (inContent && quill) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const caretRect = sel.getRangeAt(0).getBoundingClientRect();
            const contentRect = (inContent as HTMLElement).getBoundingClientRect();
            // If caret is NOT near the bottom, let browser handle line navigation
            if (caretRect.bottom + 4 < contentRect.bottom) {
              e.stopPropagation();
              return;
            }
          }
          e.preventDefault();
          e.stopPropagation();
          const blot = Quill.find(block);
          if (blot) {
            const index = quill.getIndex(blot as any) + 1;
            quill.setSelection(index, 0, Quill.sources.USER);
            quill.focus();
          }
          return;
        }
      }

      if (e.key === "ArrowUp" && inSummary && quill) {
        e.preventDefault();
        e.stopPropagation();
        const blot = Quill.find(block);
        if (blot) {
          const index = quill.getIndex(blot as any);
          const targetIndex = Math.max(0, index - 1);
          quill.setSelection(targetIndex, 0, Quill.sources.USER);
          quill.focus();
        }
        return;
      }

      if (e.key === "ArrowLeft" && inContent && summaryEl) {
        if (isCaretAtStart(inContent as HTMLElement)) {
          const lineEl = getCurrentLineElement(inContent as HTMLElement);
          if (lineEl && lineEl.previousElementSibling) {
            // Let native behavior move caret to previous line end.
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          focusSummaryEnd(summaryEl);
          return;
        }
      }

      if (e.key === "ArrowUp" && inContent) {
        // Only jump to summary if cursor is on the first line
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const caretRect = sel.getRangeAt(0).getBoundingClientRect();
          const contentRect = (inContent as HTMLElement).getBoundingClientRect();
          // If caret is NOT near the top, let browser handle line navigation
          if (caretRect.top - 4 > contentRect.top) {
            e.stopPropagation();
            return;
          }
        }
        if (summaryEl) {
          e.preventDefault();
          e.stopPropagation();
          focusSummaryEnd(summaryEl);
          return;
        }
      }
    };

    // Intercept paste/drop inside answer blocks so images go into the
    // answer DOM instead of Quill's main document.
    const insertMediaIntoAnswer = async (
      file: File,
      answerEl: HTMLElement,
      blockIndex: number,
    ) => {
      const uploaded = await uploadFileForDetails(file);
      if (!uploaded) return;
      const liveTarget = resolveLiveAnswerTarget(quill, answerEl, blockIndex);
      if (!liveTarget) return;
      liveTarget.focus();
      muteQuillObserver(() => {
        const range = getInsertionRangeInAnswer(liveTarget);
        if (uploaded.contentType.startsWith("image/")) {
          const img = document.createElement("img");
          img.setAttribute(HANDBOOK_IMAGE_SOURCE_ATTR, uploaded.url);
          img.alt = uploaded.name || "image";
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          range.insertNode(img);
          const br = document.createElement("br");
          img.after(br);
          range.setStartAfter(br);
          range.collapse(true);
        } else {
          const anchor = document.createElement("a");
          anchor.href = uploaded.url;
          anchor.textContent =
            uploaded.name?.replace(/\.[^/.]+$/i, "") || uploaded.url;
          range.insertNode(anchor);
          const space = document.createTextNode(" ");
          anchor.after(space);
          range.setStartAfter(space);
          range.collapse(true);
        }
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        const block = liveTarget.closest(
          ".ql-details-block",
        ) as HTMLElement | null;
        if (block) block.dataset.content = liveTarget.innerHTML;
      });
      syncDetailsSelectionSnapshot(liveTarget);
      syncProtectedImagePreviews(quill.root);
      quill.root.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const getAnswerContext = (target: HTMLElement) => {
      const answerEl = target.closest?.(
        ".ql-details-content",
      ) as HTMLElement | null;
      if (!answerEl) return null;
      const block = answerEl.closest(
        ".ql-details-block",
      ) as HTMLElement | null;
      const blockIndex = block
        ? Array.from(
            quill.root.querySelectorAll<HTMLElement>(".ql-details-block"),
          ).indexOf(block)
        : -1;
      return { answerEl, blockIndex };
    };

    const findMediaFile = (files: FileList | File[]) =>
      Array.from(files).find(
        (f) =>
          f.type.startsWith("image/") ||
          f.type.startsWith("video/") ||
          f.type === "application/pdf",
      );

    const handleAnswerPaste = (event: ClipboardEvent) => {
      const ctx = getAnswerContext(event.target as HTMLElement);
      if (!ctx) return;
      const file = findMediaFile(
        Array.from(event.clipboardData?.files || []),
      );
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      insertMediaIntoAnswer(file, ctx.answerEl, ctx.blockIndex);
    };

    const handleAnswerDrop = (event: DragEvent) => {
      const ctx = getAnswerContext(event.target as HTMLElement);
      if (!ctx) return;
      const file = findMediaFile(
        Array.from(event.dataTransfer?.files || []),
      );
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      insertMediaIntoAnswer(file, ctx.answerEl, ctx.blockIndex);
    };

    const handleAnswerDragover = (event: DragEvent) => {
      if ((event.target as HTMLElement).closest?.(".ql-details-content")) {
        event.preventDefault();
      }
    };

    quill.root.addEventListener("paste", handleAnswerPaste, true);
    quill.root.addEventListener("drop", handleAnswerDrop, true);
    quill.root.addEventListener("dragover", handleAnswerDragover, true);
    quill.root.addEventListener("mousedown", handleMousedown, true);
    quill.root.addEventListener("click", handleClick);
    quill.root.addEventListener("focusin", handleFocusIn);
    quill.root.addEventListener("input", handleInput);
    quill.root.addEventListener("keyup", syncDetailsSelection);
    quill.root.addEventListener("mouseup", syncDetailsSelection);
    quill.root.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("selectionchange", syncDetailsSelection);
    return () => {
      quill.root.removeEventListener("paste", handleAnswerPaste, true);
      quill.root.removeEventListener("drop", handleAnswerDrop, true);
      quill.root.removeEventListener("dragover", handleAnswerDragover, true);
      quill.root.removeEventListener("mousedown", handleMousedown, true);
      quill.root.removeEventListener("click", handleClick);
      quill.root.removeEventListener("focusin", handleFocusIn);
      quill.root.removeEventListener("input", handleInput);
      quill.root.removeEventListener("keyup", syncDetailsSelection);
      quill.root.removeEventListener("mouseup", syncDetailsSelection);
      quill.root.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("selectionchange", syncDetailsSelection);
    };
  };

  createEffect(() => {
    if (!editorRef || quillInstance) return;
    quillInstance = new Quill(editorRef, {
      theme: "snow",
      modules: {
        toolbar: {
          container: [
            [{ header: [1, false] }],
            ["undo", "redo"],
            ["bold", "italic", "underline"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["link", "image"],
            ["details"],
          ],
          handlers: {
            bold: function (this: { quill: Quill }) {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              if (!detailsTarget) {
                const range = quill.getSelection(true);
                const current = range ? quill.getFormat(range).bold : false;
                quill.format("bold", !current, Quill.sources.USER);
                return;
              }
              detailsTarget.focus();
              if (lastDetailsSelection) {
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(lastDetailsSelection.cloneRange());
                }
              }
              document.execCommand("bold");
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                lastDetailsSelection = sel.getRangeAt(0).cloneRange();
                lastDetailsEditable = detailsTarget;
              }
              quill.root.dispatchEvent(new Event("input", { bubbles: true }));
              updateDetailsToolbarActive(quill);
            },
            italic: function (this: { quill: Quill }) {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              if (!detailsTarget) {
                const range = quill.getSelection(true);
                const current = range ? quill.getFormat(range).italic : false;
                quill.format("italic", !current, Quill.sources.USER);
                return;
              }
              detailsTarget.focus();
              if (lastDetailsSelection) {
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(lastDetailsSelection.cloneRange());
                }
              }
              document.execCommand("italic");
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                lastDetailsSelection = sel.getRangeAt(0).cloneRange();
                lastDetailsEditable = detailsTarget;
              }
              quill.root.dispatchEvent(new Event("input", { bubbles: true }));
              updateDetailsToolbarActive(quill);
            },
            underline: function (this: { quill: Quill }) {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              if (!detailsTarget) {
                const range = quill.getSelection(true);
                const current = range ? quill.getFormat(range).underline : false;
                quill.format("underline", !current, Quill.sources.USER);
                return;
              }
              detailsTarget.focus();
              if (lastDetailsSelection) {
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(lastDetailsSelection.cloneRange());
                }
              }
              document.execCommand("underline");
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                lastDetailsSelection = sel.getRangeAt(0).cloneRange();
                lastDetailsEditable = detailsTarget;
              }
              quill.root.dispatchEvent(new Event("input", { bubbles: true }));
              updateDetailsToolbarActive(quill);
            },
            list: function (this: { quill: Quill }, value: "ordered" | "bullet") {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              const inAnswer = detailsTarget?.classList.contains("ql-details-content");
              if (!detailsTarget || !inAnswer) {
                const range = quill.getSelection(true);
                if (!range) return;
                quill.format(
                  "list",
                  value === "ordered" ? "ordered" : "bullet",
                  Quill.sources.USER,
                );
                return;
              }
              restoreDetailsSelection(detailsTarget);
              document.execCommand(
                value === "ordered" ? "insertOrderedList" : "insertUnorderedList",
              );
              syncDetailsSelectionSnapshot(detailsTarget);
              quill.root.dispatchEvent(new Event("input", { bubbles: true }));
            },
            undo: function (this: { quill: Quill }) {
              this.quill.history.undo();
            },
            redo: function (this: { quill: Quill }) {
              this.quill.history.redo();
            },
            details: function (this: { quill: Quill }) {
              const quill = this.quill;
              const range = quill.getSelection(true);
              quill.insertEmbed(
                range ? range.index : quill.getLength(),
                "details-block",
                { summary: "", content: "" },
                Quill.sources.USER,
              );
            },
            link: function (this: { quill: Quill }) {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              const inAnswer = detailsTarget?.classList.contains("ql-details-content");
              if (detailsTarget && inAnswer) {
                const block = detailsTarget.closest(
                  ".ql-details-block",
                ) as HTMLElement | null;
                const blockIndex = block
                  ? Array.from(
                      quill.root.querySelectorAll<HTMLElement>(".ql-details-block"),
                    ).indexOf(block)
                  : -1;
                const liveTarget = resolveLiveAnswerTarget(
                  quill,
                  detailsTarget,
                  blockIndex,
                );
                if (!liveTarget) return;
                restoreDetailsSelection(liveTarget);

                const sel = window.getSelection();
                const hasSelection =
                  !!sel &&
                  sel.rangeCount > 0 &&
                  !sel.getRangeAt(0).collapsed &&
                  liveTarget.contains(sel.getRangeAt(0).commonAncestorContainer);

                if (!hasSelection) {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "application/pdf,video/*,image/*";
                  input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      const uploaded = await uploadFileForDetails(file);
                      if (!uploaded) return;
                      const answerTarget = resolveLiveAnswerTarget(
                        quill,
                        liveTarget,
                        blockIndex,
                      );
                      if (!answerTarget) return;
                      answerTarget.focus();
                      const range = getInsertionRangeInAnswer(answerTarget);
                      const anchor = document.createElement("a");
                      anchor.href = uploaded.url;
                      anchor.textContent =
                        uploaded.name?.replace(/\.[^/.]+$/i, "") || uploaded.url;
                      range.insertNode(anchor);
                      const space = document.createTextNode(" ");
                      anchor.after(space);
                      range.setStartAfter(space);
                      range.collapse(true);
                      const nextSel = window.getSelection();
                      if (nextSel) {
                        nextSel.removeAllRanges();
                        nextSel.addRange(range);
                      }
                      syncDetailsSelectionSnapshot(answerTarget);
                      quill.root.dispatchEvent(
                        new Event("input", { bubbles: true }),
                      );
                    } catch (err) {
                      console.error("Failed to upload attachment", err);
                      handleUploadError("Unable to upload attachment.");
                    }
                  };
                  input.click();
                  return;
                }

                const href = window.prompt("Enter link URL");
                if (!href) return;
                if (sel && sel.rangeCount > 0) {
                  const range = sel.getRangeAt(0);
                  if (liveTarget.contains(range.commonAncestorContainer)) {
                    document.execCommand("createLink", false, href);
                  }
                }
                syncDetailsSelectionSnapshot(liveTarget);
                quill.root.dispatchEvent(new Event("input", { bubbles: true }));
                return;
              }
              const range = quill.getSelection(true);
              if (range) {
                const format = quill.getFormat(range);
                if (format.link) {
                  if (range.length > 0) {
                    quill.format("link", false, Quill.sources.USER);
                    return;
                  }
                  const [leaf] = quill.getLeaf(range.index);
                  const linkBlot = leaf?.parent && (leaf.parent.statics?.blotName === "link" ? leaf.parent : null);
                  if (linkBlot) {
                    const index = linkBlot.offset(quill.scroll);
                    const length = linkBlot.length();
                    quill.formatText(index, length, "link", false, Quill.sources.USER);
                    return;
                  }
                  quill.format("link", false, Quill.sources.USER);
                  return;
                }
              }
              if (!range || range.length === 0) {
                openAttachmentPicker(quill);
                return;
              }
              const href = window.prompt("Enter link URL");
              if (!href) return;
              quill.format("link", href, Quill.sources.USER);
            },
            image: function (this: { quill: Quill }) {
              const quill = this.quill;
              const detailsTarget = resolveDetailsFormattingTarget(quill);
              const inAnswer = detailsTarget?.classList.contains("ql-details-content");
              if (!detailsTarget || !inAnswer) {
                openMediaPicker(quill);
                return;
              }
              const block = detailsTarget.closest(
                ".ql-details-block",
              ) as HTMLElement | null;
              const blockIndex = block
                ? Array.from(
                    quill.root.querySelectorAll<HTMLElement>(".ql-details-block"),
                  ).indexOf(block)
                : -1;
              // Save cursor position before file picker steals focus
              const savedRange = getInsertionRangeInAnswer(detailsTarget);
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const uploaded = await uploadFileForDetails(file);
                  if (!uploaded) return;
                  const liveTarget = resolveLiveAnswerTarget(
                    quill,
                    detailsTarget,
                    blockIndex,
                  );
                  if (!liveTarget) return;
                  // Mute Quill's observer so the <img> isn't extracted
                  // from the embed by Quill's mutation processing.
                  muteQuillObserver(() => {
                    // Use saved cursor if it's still valid, otherwise end
                    const range =
                      liveTarget.contains(savedRange.commonAncestorContainer)
                        ? savedRange
                        : (() => {
                            const r = document.createRange();
                            r.selectNodeContents(liveTarget);
                            r.collapse(false);
                            return r;
                          })();
                    range.collapse(false);
                    const img = document.createElement("img");
                    img.setAttribute(HANDBOOK_IMAGE_SOURCE_ATTR, uploaded.url);
                    img.alt = uploaded.name || "image";
                    img.style.maxWidth = "100%";
                    img.style.height = "auto";
                    range.insertNode(img);
                    const br = document.createElement("br");
                    img.after(br);
                    range.setStartAfter(br);
                    range.collapse(true);
                    const sel = window.getSelection();
                    if (sel) {
                      sel.removeAllRanges();
                      sel.addRange(range);
                    }
                    // Sync data-content before observer reconnects
                    const block = liveTarget.closest(
                      ".ql-details-block",
                    ) as HTMLElement | null;
                    if (block) block.dataset.content = liveTarget.innerHTML;
                  });
                  syncDetailsSelectionSnapshot(liveTarget);
                  syncProtectedImagePreviews(quill.root);
                  quill.root.dispatchEvent(new Event("input", { bubbles: true }));
                } catch (err) {
                  console.error("Failed to upload media", err);
                  handleUploadError("Unable to upload file.");
                }
              };
              input.click();
            },
          },
        },
        // imageCompressor removed — it overrides our custom image toolbar
        // handler via addHandler("image"), breaking answer-block insertion.
        // Image uploads are handled by uploadFileToEditor / uploadFileForDetails.
      },
    });

    cleanupMainMediaHandlers = attachMediaHandlers(quillInstance);
    cleanupAnswerMediaHandlers = setupDetailsHandlers(quillInstance);
    cleanupToolbarFocusGuard = attachToolbarFocusGuard(quillInstance);
    cleanupToolbarMetrics = setupToolbarMetrics();
    updateToolbarAvailability(quillInstance, null);

    quillInstance.on("text-change", () => {
      if (isInternalUpdate) return;
      syncProtectedImagePreviews(quillInstance.root);
      const html = buildPersistedEditorHtml(quillInstance.root);
      if (lastAppliedHtml && html === lastAppliedHtml) {
        lastAppliedHtml = "";
        return;
      }
      const detailsHtml = embedsToDetailsHtml(html);
      if (detailsHtml === currentDetailsHtml) return;
      currentDetailsHtml = detailsHtml;
      if (pendingEmitFrame !== null) {
        cancelAnimationFrame(pendingEmitFrame);
      }
      pendingEmitFrame = requestAnimationFrame(() => {
        pendingEmitFrame = null;
        props.onChange(detailsHtml);
      });
      if (quillInstance?.root) {
        reconcileMediaPaths(quillInstance.root);
      }
    });
  });

  createEffect(() => {
    if (!quillInstance) return;
    if (isInternalUpdate) return;
    const inputHtml = props.value || "";
    if (inputHtml === currentDetailsHtml) return;
    currentDetailsHtml = inputHtml;
    const converted = detailsHtmlToEmbeds(inputHtml);
    if (quillInstance.root.innerHTML === converted) {
      lastAppliedHtml = buildPersistedEditorHtml(quillInstance.root);
      return;
    }
    isInternalUpdate = true;
    quillInstance.root.innerHTML = converted;
    if (!quillInstance.hasFocus()) {
      quillInstance.setSelection(
        quillInstance.getLength(),
        0,
        Quill.sources.SILENT,
      );
    }
    quillInstance.update(Quill.sources.SILENT);
    syncProtectedImagePreviews(quillInstance.root);
    lastAppliedHtml = buildPersistedEditorHtml(quillInstance.root);
    requestAnimationFrame(() => {
      isInternalUpdate = false;
    });
    knownMediaPaths = collectMediaPaths(quillInstance.root);
  });

  onCleanup(() => {
    cleanupMainMediaHandlers?.();
    cleanupAnswerMediaHandlers?.();
    cleanupToolbarFocusGuard?.();
    cleanupToolbarMetrics?.();
    Array.from(editorImagePreviewUrls.keys()).forEach((img) => {
      revokeProtectedImagePreview(img);
    });
  });

  createEffect(() => {
    props.onUploadStatusChange?.(uploadingCount());
  });

  return (
    <div ref={containerRef} class="handbook-editor bg-white">
      <div ref={editorRef} />
      <DeleteQAModal />
    </div>
  );
};
