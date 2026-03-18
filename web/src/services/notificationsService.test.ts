import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, authFetchMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  API_BASE: "https://api.example.test",
  authJson: (...args: unknown[]) => authJsonMock(...args),
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getCaptchaAwareErrorMessage: (error: unknown, fallbackMessage: string) =>
    error instanceof Error && error.message.includes("https://mfag.sg")
      ? error.message
      : fallbackMessage,
}));

import { notificationsService } from "./notificationsService";

describe("notificationsService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    authFetchMock.mockReset();
  });

  it("maps notifications and attachments from API payload", async () => {
    authJsonMock.mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          title: " Policy Update ",
          body: "Read this",
          createdAt: "2026-02-24T12:00:00.000Z",
          createdBy: "admin-1",
          createdByName: "Admin",
          sentAt: "2026-02-24T13:00:00.000Z",
          type: "warning",
          attachments: [
            {
              id: "7",
              name: "brief.pdf",
              mimeType: "application/pdf",
              sizeBytes: "321",
              createdAt: "2026-02-24T14:00:00.000Z",
              downloadUrl: "/downloads/brief.pdf",
            },
            {
              id: 8,
              name: "cdn.bin",
              mimeType: "application/octet-stream",
              sizeBytes: 2,
              downloadUrl: "https://cdn.example.test/files/cdn.bin",
            },
            {
              id: "9",
            },
          ],
        },
        {
          id: "notif-2",
          type: "unknown",
          attachments: null,
        },
      ],
    });

    const result = await notificationsService.getNotifications(25);

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/notifications?limit=25",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("notif-1");
    expect(result[0].title).toBe(" Policy Update ");
    expect(result[0].type).toBe("warning");
    expect(result[0].createdAt.toISOString()).toBe("2026-02-24T12:00:00.000Z");
    expect(result[0].sentAt?.toISOString()).toBe("2026-02-24T13:00:00.000Z");
    expect(result[0].attachments).toEqual([
      {
        id: 7,
        name: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        createdAt: new Date("2026-02-24T14:00:00.000Z"),
        url: "https://api.example.test/downloads/brief.pdf",
      },
      {
        id: 8,
        name: "cdn.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 2,
        createdAt: undefined,
        url: "https://cdn.example.test/files/cdn.bin",
      },
      {
        id: 9,
        name: "Attachment",
        mimeType: "application/octet-stream",
        sizeBytes: 0,
        createdAt: undefined,
        url: "https://api.example.test/api/notifications/attachments/9",
      },
    ]);
    expect(result[1].type).toBeUndefined();
    expect(result[1].createdAt).toBeInstanceOf(Date);
    expect(result[1].attachments).toEqual([]);
  });

  it("returns null when getNotification payload has no notification", async () => {
    authJsonMock.mockResolvedValue({});

    const result = await notificationsService.getNotification("abc/123");

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/notifications/abc%2F123",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
    expect(result).toBeNull();
  });

  it("falls back to markNotificationsAsRead for non-numeric notification ids", async () => {
    const markAllSpy = vi
      .spyOn(notificationsService, "markNotificationsAsRead")
      .mockResolvedValue(undefined);

    await notificationsService.markNotificationAsRead("user-1", "draft-id");

    expect(markAllSpy).toHaveBeenCalledWith("user-1");
    expect(authJsonMock).not.toHaveBeenCalled();
  });

  it("sends a notification id when markNotificationAsRead receives a numeric id", async () => {
    authJsonMock.mockResolvedValue({ ok: true });

    await notificationsService.markNotificationAsRead("user/1", "10.9");

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/notifications/read-state/user%2F1",
      {
        method: "PUT",
        body: JSON.stringify({ notificationId: 10 }),
      },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("opens an attachment preview in a new tab", async () => {
    if (!("createObjectURL" in window.URL)) {
      Object.defineProperty(window.URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }

    const createObjectUrlSpy = vi
      .spyOn(window.URL, "createObjectURL")
      .mockReturnValue("blob:preview-1");
    const previewWindow = {
      location: { href: "" },
      closed: false,
      close: vi.fn(),
    };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(previewWindow as unknown as Window);

    authFetchMock.mockResolvedValue(
      new Response(new Blob(["file-content"], { type: "application/pdf" }), {
        status: 200,
      }),
    );

    await notificationsService.previewAttachment({
      id: 101,
      name: "preview.pdf",
      mimeType: "application/pdf",
      sizeBytes: 64,
      url: "https://api.example.test/files/101",
    });

    expect(authFetchMock).toHaveBeenCalledWith("https://api.example.test/files/101", {
      method: "GET",
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(previewWindow.location.href).toBe("blob:preview-1");
  });

  it("downloads an attachment with filename from content disposition", async () => {
    if (!("createObjectURL" in window.URL)) {
      Object.defineProperty(window.URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }
    if (!("revokeObjectURL" in window.URL)) {
      Object.defineProperty(window.URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }

    const createObjectUrlSpy = vi
      .spyOn(window.URL, "createObjectURL")
      .mockReturnValue("blob:download-1");
    const revokeObjectUrlSpy = vi
      .spyOn(window.URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");

    authFetchMock.mockResolvedValue(
      new Response(new Blob(["file-content"], { type: "application/pdf" }), {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''policy%20guide.pdf",
        },
      }),
    );

    await notificationsService.downloadAttachment({
      id: 101,
      name: "fallback.pdf",
      mimeType: "application/pdf",
      sizeBytes: 64,
      url: "https://api.example.test/files/101",
    });

    expect(authFetchMock).toHaveBeenCalledWith("https://api.example.test/files/101", {
      method: "GET",
    });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);

    const link = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(link.download).toBe("policy guide.pdf");
    expect(link.href).toBe("blob:download-1");

    expect(removeSpy).toHaveBeenCalledWith(link);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:download-1");
  });

  it("throws when downloadAttachment receives a failed response", async () => {
    authFetchMock.mockResolvedValue(new Response("failed", { status: 500 }));

    await expect(
      notificationsService.downloadAttachment({
        id: 1,
        name: "broken.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        url: "https://api.example.test/files/1",
      }),
    ).rejects.toThrow("Unable to download attachment");
  });

  it("throws when uploadAttachment response is missing attachment payload", async () => {
    authJsonMock.mockResolvedValue({});

    const file = new File(["data"], "info.txt", { type: "text/plain" });

    await expect(notificationsService.uploadAttachment("draft-7", file)).rejects.toThrow(
      "Attachment upload failed",
    );
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/notifications/draft-7/attachments",
      {
        method: "POST",
        body: expect.any(FormData),
      },
      { defaultErrorMessage: "Request failed" },
    );
  });
});
