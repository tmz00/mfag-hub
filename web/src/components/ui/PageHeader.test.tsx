import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
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
});
