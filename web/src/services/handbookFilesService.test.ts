import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, authFetchMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  API_BASE: "https://api.example.test",
  authJson: (...args: unknown[]) => authJsonMock(...args),
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

import {
  deleteHandbookFileById,
  deleteHandbookFileByPath,
  fetchHandbookFile,
  isHandbookApiFileUrl,
  resolveHandbookFileUrl,
  uploadHandbookFile,
} from "./handbookFilesService";

describe("handbookFilesService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    authFetchMock.mockReset();
  });

  it("uploads a file and maps backend payload fields", async () => {
    const file = new File(["image-bytes"], "cover.png", {
      type: "image/png",
    });
    authJsonMock.mockResolvedValue({
      id: "7",
      path: "handbook/server-file.png",
      name: "server-file.png",
      sizeBytes: "321",
      mimeType: "image/webp",
    });

    const uploaded = await uploadHandbookFile(file);

    expect(uploaded).toEqual({
      id: 7,
      path: "handbook/server-file.png",
      name: "server-file.png",
      sizeBytes: 321,
      mimeType: "image/webp",
      url: "https://api.example.test/api/handbook/file/7?name=server-file.png",
    });

    const [path, requestInit, options] = authJsonMock.mock.calls[0] as [
      string,
      RequestInit,
      { defaultErrorMessage: string },
    ];
    expect(path).toBe("/api/handbook/upload");
    expect(requestInit.method).toBe("POST");
    expect(options).toEqual({ defaultErrorMessage: "Upload failed" });

    const formData = requestInit.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("folder")).toBeNull();
    expect(formData.get("file")).toBe(file);
  });

  it("falls back to file metadata when upload payload is missing fields", async () => {
    const file = new File(["notes"], "notes.txt", {
      type: "text/plain",
    });
    authJsonMock.mockResolvedValue({});

    const uploaded = await uploadHandbookFile(file);

    expect(uploaded).toEqual({
      id: 0,
      path: "",
      name: "notes.txt",
      sizeBytes: file.size,
      mimeType: "text/plain",
      url: "https://api.example.test/api/handbook/file/0?name=notes.txt",
    });
  });

  it("deletes a handbook file by id", async () => {
    authJsonMock.mockResolvedValue({ deleted: true });

    await deleteHandbookFileById(42);

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/handbook/file/42",
      { method: "DELETE" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("deletes a handbook file by path", async () => {
    authJsonMock.mockResolvedValue({ deleted: true });

    await deleteHandbookFileByPath("handbook/cover.png");

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/handbook/file",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "handbook/cover.png" }),
      },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("resolves handbook file URLs against the API host", () => {
    expect(resolveHandbookFileUrl("/api/handbook/file/7")).toBe(
      "https://api.example.test/api/handbook/file/7",
    );
    expect(
      resolveHandbookFileUrl(
        "https://hub.mfag.sg/api/handbook/file/7?name=guide.pdf",
      ),
    ).toBe("https://api.example.test/api/handbook/file/7?name=guide.pdf");
  });

  it("fetches a handbook file using authenticated fetch", async () => {
    const response = new Response("ok", { status: 200 });
    authFetchMock.mockResolvedValue(response);

    const result = await fetchHandbookFile(
      "https://hub.mfag.sg/api/handbook/file/7?name=guide.pdf",
    );

    expect(result).toBe(response);
    expect(authFetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/handbook/file/7?name=guide.pdf",
      { method: "GET" },
    );
  });

  it("detects id-based handbook file URLs", () => {
    expect(isHandbookApiFileUrl("/api/handbook/file/7")).toBe(true);
    expect(isHandbookApiFileUrl("http://192.168.1.10:3000/api/handbook/file/37")).toBe(true);
    expect(isHandbookApiFileUrl("/api/handbook/files")).toBe(false);
    expect(isHandbookApiFileUrl("/api/handbook/file/abc")).toBe(false);
    expect(isHandbookApiFileUrl("")).toBe(false);
  });
});
