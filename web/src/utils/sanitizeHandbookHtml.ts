const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "iframe",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);

const BLOCKED_TAGS = new Set([
  "button",
  "embed",
  "form",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "textarea",
]);

const ALLOWED_IFRAME_HOSTS = new Set([
  "player.vimeo.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "youtube.com",
  "youtube-nocookie.com",
]);

const sanitizeIframeUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    if (url.protocol !== "https:" || !ALLOWED_IFRAME_HOSTS.has(host)) {
      return null;
    }

    if (
      ["www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "youtube-nocookie.com"].includes(
        host,
      )
    ) {
      return path.startsWith("/embed/") ? value : null;
    }

    if (host === "player.vimeo.com") {
      return path.startsWith("/video/") ? value : null;
    }

    return null;
  } catch {
    return null;
  }
};

const sanitizeClassList = (value: string) =>
  value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part !== "" &&
        (part === "is-collapsed" || /^ql-[a-z0-9-]+$/i.test(part)),
    )
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(" ");

const sanitizeUrl = (
  value: string,
  options: { allowDataImage?: boolean; iframeOnly?: boolean } = {},
) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (options.allowDataImage && /^data:image\//i.test(trimmed)) {
    return trimmed;
  }
  if (
    !options.iframeOnly &&
    (
      trimmed.startsWith("#") ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../")
    )
  ) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed, window.location.origin);
    if (options.iframeOnly) {
      return sanitizeIframeUrl(url.toString());
    }

    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? trimmed
      : null;
  } catch {
    if (options.iframeOnly) {
      return null;
    }

    return /^javascript:/i.test(trimmed) ? null : trimmed;
  }
};

const setBoundedTextAttribute = (
  element: Element,
  attributeMap: Map<string, string>,
  name: string,
  maxLength: number,
) => {
  const value = (attributeMap.get(name) || "").trim();
  if (value) {
    element.setAttribute(name, value.slice(0, maxLength));
  }
};

const setNumericAttribute = (
  element: Element,
  attributeMap: Map<string, string>,
  name: string,
  min: number,
  max: number,
) => {
  const value = (attributeMap.get(name) || "").trim();
  if (!/^\d+$/.test(value)) return;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return;
  }

  element.setAttribute(name, String(parsed));
};

const sanitizeElement = (element: Element) => {
  const tagName = element.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  const originalAttributes = Array.from(element.attributes).map((attribute) => [
    attribute.name.toLowerCase(),
    attribute.value,
  ]);
  Array.from(element.attributes).forEach((attribute) =>
    element.removeAttribute(attribute.name),
  );

  const attributeMap = new Map(originalAttributes);
  const className = sanitizeClassList(attributeMap.get("class") || "");
  if (className) {
    element.setAttribute("class", className);
  }

  if (tagName === "a") {
    const href = sanitizeUrl(attributeMap.get("href") || "");
    if (href) {
      element.setAttribute("href", href);
    }
    if ((attributeMap.get("target") || "").trim().toLowerCase() === "_blank") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    const title = (attributeMap.get("title") || "").trim();
    if (title) {
      element.setAttribute("title", title.slice(0, 255));
    }
    return;
  }

  if (tagName === "img") {
    const src = sanitizeUrl(attributeMap.get("src") || "", {
      allowDataImage: true,
    });
    if (!src) {
      element.remove();
      return;
    }
    element.setAttribute("src", src);
    setBoundedTextAttribute(element, attributeMap, "alt", 255);
    setBoundedTextAttribute(element, attributeMap, "title", 255);
    setNumericAttribute(element, attributeMap, "width", 1, 4096);
    setNumericAttribute(element, attributeMap, "height", 1, 4096);
    return;
  }

  if (tagName === "iframe") {
    const src = sanitizeUrl(attributeMap.get("src") || "", {
      iframeOnly: true,
    });
    if (!src) {
      element.remove();
      return;
    }
    element.setAttribute("src", src);
    element.setAttribute("frameborder", "0");
    element.setAttribute("allowfullscreen", "allowfullscreen");
    setBoundedTextAttribute(element, attributeMap, "allow", 255);
    setNumericAttribute(element, attributeMap, "width", 1, 4096);
    setNumericAttribute(element, attributeMap, "height", 1, 4096);
    return;
  }

  if (tagName === "video") {
    const src = sanitizeUrl(attributeMap.get("src") || "");
    if (src) {
      element.setAttribute("src", src);
    }
    const poster = sanitizeUrl(attributeMap.get("poster") || "", {
      allowDataImage: true,
    });
    if (poster) {
      element.setAttribute("poster", poster);
    }
    ["controls", "playsinline", "muted", "loop", "autoplay"].forEach(
      (name) => {
        if (attributeMap.has(name)) {
          element.setAttribute(name, name);
        }
      },
    );
    return;
  }

  if (tagName === "source") {
    const src = sanitizeUrl(attributeMap.get("src") || "");
    if (!src) {
      element.remove();
      return;
    }
    element.setAttribute("src", src);
    const type = (attributeMap.get("type") || "").trim();
    if (type) {
      element.setAttribute("type", type.slice(0, 120));
    }
    return;
  }

  if (tagName === "details" && attributeMap.has("open")) {
    element.setAttribute("open", "open");
  }

  if (tagName === "td" || tagName === "th") {
    setNumericAttribute(element, attributeMap, "colspan", 1, 24);
    setNumericAttribute(element, attributeMap, "rowspan", 1, 24);
    if (tagName === "th") {
      const scope = (attributeMap.get("scope") || "").trim().toLowerCase();
      if (["col", "row", "colgroup", "rowgroup"].includes(scope)) {
        element.setAttribute("scope", scope);
      }
    }
  }
};

export const sanitizeHandbookHtml = (html: string) => {
  if (!html || typeof document === "undefined") return html;

  const container = document.createElement("div");
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  const commentNodes: Node[] = [];
  while (walker.nextNode()) {
    commentNodes.push(walker.currentNode);
  }
  commentNodes.forEach((node) => node.parentNode?.removeChild(node));
  Array.from(container.querySelectorAll("*"))
    .reverse()
    .forEach((element) => sanitizeElement(element));
  return container.innerHTML;
};

export default sanitizeHandbookHtml;
