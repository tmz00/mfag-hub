import { describe, expect, it } from "vitest";

import { resolveEditModalThemeColorVariant } from "./EditModal";

describe("resolveEditModalThemeColorVariant", () => {
  it("defaults admin routes to the admin theme color", () => {
    expect(resolveEditModalThemeColorVariant(undefined, "/admin")).toBe("admin");
    expect(resolveEditModalThemeColorVariant(undefined, "/admin/sources")).toBe("admin");
    expect(resolveEditModalThemeColorVariant(undefined, "/report-templates")).toBe("admin");
  });

  it("defaults non-admin routes to the plain theme color", () => {
    expect(resolveEditModalThemeColorVariant(undefined, "/settings/profile")).toBe("plain");
    expect(resolveEditModalThemeColorVariant(undefined, "/closings/submit")).toBe("plain");
  });

  it("honors explicit overrides", () => {
    expect(resolveEditModalThemeColorVariant("dashboard", "/admin/products")).toBe(
      "dashboard",
    );
  });
});
