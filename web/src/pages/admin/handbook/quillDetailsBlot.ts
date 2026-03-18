import Quill from "quill";

import { sanitizeHandbookHtml } from "../../../utils/sanitizeHandbookHtml";

const BlockEmbed = Quill.import("blots/block/embed") as any;

export type DetailsValue = {
  summary: string;
  content: string;
  collapsed?: boolean;
};

/**
 * DetailsBlot — a non-editable embed that renders a FAQ card
 * with Edit / Delete buttons. Data is stored in data-* attributes;
 * the visible preview is rebuilt by `renderPreview`.
 */
class DetailsBlot extends BlockEmbed {
  static blotName = "details-block";
  static tagName = "DIV";
  static className = "ql-details-block";

  static create(value: DetailsValue) {
    const node = super.create() as HTMLDivElement;
    node.setAttribute("contenteditable", "false");
    node.dataset.summary = value.summary || "";
    node.dataset.content = value.content || "";
    node.dataset.collapsed = value.collapsed ? "true" : "false";
    if (value.collapsed) {
      node.classList.add("is-collapsed");
    } else {
      node.classList.remove("is-collapsed");
    }
    DetailsBlot.renderPreview(node, value);
    return node;
  }

  static renderPreview(node: HTMLDivElement, value: DetailsValue) {
    const summary = sanitizeHandbookHtml(value.summary || "Question here");
    const content = sanitizeHandbookHtml(value.content || "<p>Answer here</p>");
    node.innerHTML =
      `<div class="ql-details-summary" contenteditable="true" tabindex="0">${summary}</div>` +
      `<div class="ql-details-content" contenteditable="true" tabindex="0">${content}</div>`;
  }

  static value(node: HTMLElement): DetailsValue {
    return {
      summary: node.dataset.summary || "",
      content: node.dataset.content || "",
      collapsed: node.dataset.collapsed === "true",
    };
  }
}

Quill.register(DetailsBlot, true);

export { DetailsBlot };
