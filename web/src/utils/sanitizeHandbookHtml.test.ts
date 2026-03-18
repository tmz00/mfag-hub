import { describe, expect, it } from "vitest";

import { sanitizeHandbookHtml } from "./sanitizeHandbookHtml";

describe("sanitizeHandbookHtml", () => {
  it("removes scripts, event handlers, and javascript urls", () => {
    expect(
      sanitizeHandbookHtml(
        '<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(2)">Bad</a>',
      ),
    ).toBe("<p>Safe</p><a>Bad</a>");
  });

  it("preserves allowed handbook markup", () => {
    expect(
      sanitizeHandbookHtml(
        '<details open><summary>Q</summary><p><img src="/api/handbook/files/7" onerror="alert(1)"></p></details>',
      ),
    ).toBe(
      '<details open="open"><summary>Q</summary><p><img src="/api/handbook/files/7"></p></details>',
    );
  });

  it("keeps allowlisted video embeds and removes other iframes", () => {
    const sanitized = sanitizeHandbookHtml(
      '<iframe src="https://www.youtube.com/embed/demo123" allow="fullscreen"></iframe><iframe src="https://example.test/embed/demo123" allow="fullscreen"></iframe><iframe src="/internal/embed/demo123"></iframe>',
    );

    expect(sanitized).toContain('https://www.youtube.com/embed/demo123');
    expect(sanitized).toContain('allowfullscreen="allowfullscreen"');
    expect(sanitized).not.toContain('https://example.test/embed/demo123');
    expect(sanitized).not.toContain('/internal/embed/demo123');
  });

  it("preserves safe media and table attributes that handbook rendering relies on", () => {
    const sanitized = sanitizeHandbookHtml(
      '<img src="/api/handbook/file/7" alt="Guide" title="Brochure" width="640" height="480" onerror="alert(1)">' +
        '<iframe src="https://www.youtube.com/embed/demo123" allow="fullscreen" width="800" height="600"></iframe>' +
        '<video src="https://cdn.example.test/demo.mp4" poster="data:image/png;base64,abc" controls></video>' +
        '<table><thead><tr><th scope="col" colspan="2">Name</th></tr></thead></table>',
    );

    expect(sanitized).toContain('title="Brochure"');
    expect(sanitized).toContain('width="640"');
    expect(sanitized).toContain('height="480"');
    expect(sanitized).toContain('width="800"');
    expect(sanitized).toContain('height="600"');
    expect(sanitized).toContain('poster="data:image/png;base64,abc"');
    expect(sanitized).toContain('controls="controls"');
    expect(sanitized).toContain('scope="col"');
    expect(sanitized).toContain('colspan="2"');
  });
});
