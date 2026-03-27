import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  beforeEach(() => {
    let meta = document.querySelector('meta[name="theme-color"]') as
      | HTMLMetaElement
      | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.append(meta);
    }
    meta.setAttribute("content", "#178e9e");

    document.documentElement.style.setProperty("--color-primary", "#178e9e");
    document.documentElement.style.setProperty("--color-primary-500", "#006a6b");
    document.documentElement.style.setProperty("--color-primary-100", "#bed9d9");
    document.documentElement.style.setProperty("--color-admin-from", "#9333ea");
  });

  it("shows the mobile admin viewing hint on admin pages", () => {
    render(() => <PageHeader variant="admin" title="Admin" />);

    const hint = screen.getByText("Best viewed in iPad/desktop");
    expect(hint).toBeTruthy();
    expect(hint.className).toContain("text-sm");
    expect(hint.className).toContain("italic");
    expect(hint.className).toContain("md:hidden");
  });

  it("does not show the viewing hint on non-admin pages", () => {
    render(() => <PageHeader variant="dashboard" title="Dashboard" />);

    expect(screen.queryByText("Best viewed in iPad/desktop")).toBeNull();
  });

  it("allows the status-bar theme color to differ from the visible header variant", () => {
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;

    const view = render(() => (
      <PageHeader
        variant="plain"
        themeColorVariant="admin"
        title="Admin modal"
      />
    ));

    expect(meta.getAttribute("content")).toBe("#9333ea");

    view.unmount();

    expect(meta.getAttribute("content")).toBe("#178e9e");
  });

  it("restores the previous theme color when stacked headers unmount", () => {
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;

    const outer = render(() => <PageHeader variant="admin" title="Admin" />);
    expect(meta.getAttribute("content")).toBe("#9333ea");

    const inner = render(() => <PageHeader variant="plain" title="Modal" />);
    expect(meta.getAttribute("content")).toBe("#178e9e");

    inner.unmount();
    expect(meta.getAttribute("content")).toBe("#9333ea");

    outer.unmount();
    expect(meta.getAttribute("content")).toBe("#178e9e");
  });
});
