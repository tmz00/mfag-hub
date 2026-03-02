import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
}));

import {
  getHandbookEntries,
  saveHandbookEntries,
  type HandbookEntry,
} from "./handbookContentService";

describe("handbookContentService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
  });

  it("loads handbook entries from handbook content endpoint", async () => {
    const payload: HandbookEntry[] = [
      { category: "Loans", content: "<p>Loan notes</p>" },
      { category: "Insurance", content: "<p>Insurance notes</p>" },
    ];
    authJsonMock.mockResolvedValue({
      name: "handbook",
      payload,
      updatedAt: "2026-02-26T10:00:00.000Z",
    });

    const data = await getHandbookEntries();

    expect(data).toEqual(payload);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/handbook/content",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("returns empty entries when backend payload is not an array", async () => {
    authJsonMock.mockResolvedValue({
      name: "handbook",
      payload: null,
      updatedAt: null,
    });

    const data = await getHandbookEntries();

    expect(data).toEqual([]);
  });

  it("saves handbook entries to handbook content endpoint", async () => {
    const entries: HandbookEntry[] = [
      {
        category: "Products",
        content: "<p>Products overview</p>",
        imageUrl: "https://cdn.example.test/image.png",
        imagePath: "handbook/categories/image.png",
      },
    ];
    authJsonMock.mockResolvedValue({ success: true });

    await saveHandbookEntries(entries);

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/handbook/content",
      {
        method: "PUT",
        body: JSON.stringify({ payload: entries }),
      },
      { defaultErrorMessage: "Request failed" },
    );
  });
});
