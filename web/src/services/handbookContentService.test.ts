import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
}));

import {
  clearHandbookEntriesCache,
  getHandbookEntries,
  saveHandbookEntries,
  type HandbookEntry,
} from "./handbookContentService";

describe("handbookContentService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    clearHandbookEntriesCache();
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

  it("reuses cached handbook entries between reads", async () => {
    const payload: HandbookEntry[] = [
      { category: "Loans", content: "<p>Loan notes</p>" },
    ];
    authJsonMock.mockResolvedValueOnce({
      name: "handbook",
      payload,
      updatedAt: "2026-02-26T10:00:00.000Z",
    });

    const first = await getHandbookEntries();
    const second = await getHandbookEntries();

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(authJsonMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when forceRefresh is enabled", async () => {
    authJsonMock
      .mockResolvedValueOnce({
        name: "handbook",
        payload: [{ category: "First", content: "<p>1</p>" }],
        updatedAt: "2026-02-26T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        name: "handbook",
        payload: [{ category: "Second", content: "<p>2</p>" }],
        updatedAt: "2026-02-26T10:10:00.000Z",
      });

    const first = await getHandbookEntries();
    const second = await getHandbookEntries({ forceRefresh: true });

    expect(first).toEqual([{ category: "First", content: "<p>1</p>" }]);
    expect(second).toEqual([{ category: "Second", content: "<p>2</p>" }]);
    expect(authJsonMock).toHaveBeenCalledTimes(2);
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

  it("updates the read cache after save", async () => {
    const initialEntries: HandbookEntry[] = [
      { category: "Initial", content: "<p>Initial</p>" },
    ];
    const savedEntries: HandbookEntry[] = [
      { category: "Updated", content: "<p>Updated</p>" },
    ];

    authJsonMock
      .mockResolvedValueOnce({
        name: "handbook",
        payload: initialEntries,
        updatedAt: "2026-02-26T10:00:00.000Z",
      })
      .mockResolvedValueOnce({ success: true });

    await getHandbookEntries();
    await saveHandbookEntries(savedEntries);
    const next = await getHandbookEntries();

    expect(next).toEqual(savedEntries);
    expect(authJsonMock).toHaveBeenCalledTimes(2);
  });
});
