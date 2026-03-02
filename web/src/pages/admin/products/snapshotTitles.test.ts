import { describe, expect, it } from "vitest";

import {
  formatProductAddSnapshotTitle,
  formatProductChangeSnapshotTitle,
} from "./snapshotTitles";

describe("formatProductChangeSnapshotTitle", () => {
  it("formats add titles with after-adding wording", () => {
    expect(
      formatProductAddSnapshotTitle("Add Base Plan", {
        id: "BP-101",
        shortName: "Starter Plan",
      }),
    ).toBe("after adding Starter Plan (ID#BP-101)");

    expect(
      formatProductAddSnapshotTitle("Add Rider / Top-up", {
        id: "RD-12",
        shortName: "Critical Care",
      }),
    ).toBe("after adding Critical Care (ID#RD-12)");
  });

  it("formats edit and delete titles with after-action wording", () => {
    expect(
      formatProductChangeSnapshotTitle("Edit", {
        id: "BP-100",
        shortName: "Starter Plan",
      }),
    ).toBe("after editing Starter Plan (ID#BP-100)");

    expect(
      formatProductChangeSnapshotTitle("Delete", {
        id: "RD-7",
        shortName: "Critical Care",
      }),
    ).toBe("after deleting Critical Care (ID#RD-7)");
  });

  it("falls back to full name when short name is unavailable", () => {
    expect(
      formatProductChangeSnapshotTitle("Edit", {
        id: "BP-200",
        shortName: "",
        fullName: "Full Product Name",
      }),
    ).toBe("after editing Full Product Name (ID#BP-200)");
  });
});
