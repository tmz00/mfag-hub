import { API_BASE, authFetch, authJson } from "./authService";

// ============ Types ============

export type NotificationType = "info" | "success" | "warning" | "alert";

export type NotificationAttachment = {
  id: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt?: Date;
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  sentAt?: Date;
  type?: NotificationType;
  attachments: NotificationAttachment[];
};

export type NotificationInput = {
  title: string;
  body: string;
  createdBy: string;
  createdByName?: string;
  type?: NotificationType;
};

export type UserNotificationStatus = {
  lastReadAt: Date | null;
};

type NotificationAttachmentApiRecord = {
  id?: number | string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string | null;
  downloadUrl?: string;
};

type NotificationApiRecord = {
  id: string;
  title?: string;
  body?: string;
  createdAt?: string | null;
  createdBy?: string;
  createdByName?: string;
  sentAt?: string | null;
  type?: NotificationType | null;
  attachments?: NotificationAttachmentApiRecord[];
};

// ============ Service ============

class NotificationsService {
  private readonly pollMs = 15000;

  private async fetchAttachmentFile(
    attachment: NotificationAttachment
  ): Promise<{ blob: Blob; contentDisposition: string | null }> {
    const response = await authFetch(attachment.url, { method: "GET" });

    if (!response.ok) {
      throw new Error("Unable to download attachment");
    }

    return {
      blob: await response.blob(),
      contentDisposition: response.headers.get("Content-Disposition"),
    };
  }

  private parseDate(value: unknown): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private parseNotificationType(value: unknown): NotificationType | undefined {
    if (value === "info" || value === "success" || value === "warning" || value === "alert") {
      return value;
    }
    return undefined;
  }

  private toAttachmentUrl(downloadUrl: unknown, id: number): string {
    const raw = String(downloadUrl || "").trim();
    if (!raw) {
      return `${API_BASE}/api/notifications/attachments/${encodeURIComponent(String(id))}`;
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return `${API_BASE}${raw.startsWith("/") ? raw : `/${raw}`}`;
  }

  private mapAttachment(row: NotificationAttachmentApiRecord): NotificationAttachment {
    const id = Number(row.id || 0);
    return {
      id,
      name: String(row.name || "Attachment"),
      mimeType: String(row.mimeType || "application/octet-stream"),
      sizeBytes: Number(row.sizeBytes || 0),
      createdAt: this.parseDate(row.createdAt),
      url: this.toAttachmentUrl(row.downloadUrl, id),
    };
  }

  private mapRecord(row: NotificationApiRecord): Notification {
    return {
      id: String(row.id || ""),
      title: String(row.title || ""),
      body: String(row.body || ""),
      createdAt: this.parseDate(row.createdAt) || new Date(),
      createdBy: String(row.createdBy || ""),
      createdByName: row.createdByName || "",
      sentAt: this.parseDate(row.sentAt),
      type: this.parseNotificationType(row.type),
      attachments: (Array.isArray(row.attachments) ? row.attachments : []).map((attachment) =>
        this.mapAttachment(attachment)
      ),
    };
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private getDownloadName(contentDisposition: string | null, fallback: string): string {
    if (!contentDisposition) return fallback;

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (asciiMatch?.[1]) return asciiMatch[1];

    return fallback;
  }

  async getNotifications(limitCount: number = 50): Promise<Notification[]> {
    const payload = await this.requestJson<{ notifications?: NotificationApiRecord[] }>(
      `/api/notifications?limit=${encodeURIComponent(String(limitCount))}`,
      { method: "GET" }
    );

    return (Array.isArray(payload.notifications) ? payload.notifications : []).map((row) =>
      this.mapRecord(row)
    );
  }

  async getNotification(id: string): Promise<Notification | null> {
    const payload = await this.requestJson<{ notification?: NotificationApiRecord }>(
      `/api/notifications/${encodeURIComponent(id)}`,
      { method: "GET" }
    );

    if (!payload.notification) return null;
    return this.mapRecord(payload.notification);
  }

  async getAllNotificationsForAdmin(): Promise<Notification[]> {
    const payload = await this.requestJson<{ notifications?: NotificationApiRecord[] }>(
      "/api/notifications/admin",
      { method: "GET" }
    );

    return (Array.isArray(payload.notifications) ? payload.notifications : []).map((row) =>
      this.mapRecord(row)
    );
  }

  subscribeToNotifications(
    callback: (notifications: Notification[]) => void,
    limitCount: number = 50
  ): () => void {
    let active = true;

    const pull = async () => {
      try {
        const notifications = await this.getNotifications(limitCount);
        if (!active) return;
        callback(notifications);
      } catch {
        if (!active) return;
      }
    };

    void pull();
    const interval = window.setInterval(() => void pull(), this.pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }

  async getNotificationById(id: string): Promise<Notification | null> {
    return this.getNotification(id);
  }

  async createNotification(input: NotificationInput): Promise<string> {
    const payload = await this.requestJson<{ id: string }>("/api/notifications", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        type: input.type || "info",
        sendNow: false,
      }),
    });
    return String(payload.id);
  }

  async createAndSendNotification(input: NotificationInput): Promise<string> {
    const payload = await this.requestJson<{ id: string }>("/api/notifications", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        type: input.type || "info",
        sendNow: true,
      }),
    });
    return String(payload.id);
  }

  async updateNotification(
    id: string,
    updates: Partial<NotificationInput>
  ): Promise<void> {
    await this.requestJson<{ id: string }>(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        title: updates.title,
        body: updates.body,
        type: updates.type,
      }),
    });
  }

  async sendNotification(id: string): Promise<void> {
    await this.requestJson<{ id: string }>(`/api/notifications/${encodeURIComponent(id)}/send`, {
      method: "POST",
    });
  }

  async deleteNotification(id: string): Promise<void> {
    await this.requestJson<{ deleted: boolean }>(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async uploadAttachment(
    notificationId: string,
    file: File
  ): Promise<NotificationAttachment> {
    const formData = new FormData();
    formData.append("file", file);

    const payload = await this.requestJson<{ attachment?: NotificationAttachmentApiRecord }>(
      `/api/notifications/${encodeURIComponent(notificationId)}/attachments`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!payload.attachment) {
      throw new Error("Attachment upload failed");
    }

    return this.mapAttachment(payload.attachment);
  }

  async deleteAttachment(notificationId: string, fileId: number): Promise<void> {
    await this.requestJson<{ deleted: boolean }>(
      `/api/notifications/${encodeURIComponent(notificationId)}/attachments/${encodeURIComponent(
        String(fileId)
      )}`,
      {
        method: "DELETE",
      }
    );
  }

  async previewAttachment(attachment: NotificationAttachment): Promise<void> {
    const previewWindow = window.open("", "_blank");

    try {
      const { blob } = await this.fetchAttachmentFile(attachment);
      const objectUrl = window.URL.createObjectURL(blob);

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = objectUrl;
        return;
      }

      const fallbackWindow = window.open(objectUrl, "_blank");
      if (!fallbackWindow) {
        window.URL.revokeObjectURL(objectUrl);
        throw new Error("Unable to open attachment preview");
      }
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
      throw error;
    }
  }

  async downloadAttachment(attachment: NotificationAttachment): Promise<void> {
    const { blob, contentDisposition } = await this.fetchAttachmentFile(attachment);
    const downloadName = this.getDownloadName(
      contentDisposition,
      attachment.name || "attachment"
    );

    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }

  async getUserLastReadAt(userId: string): Promise<Date | null> {
    const payload = await this.requestJson<{ lastReadAt?: string | null }>(
      `/api/notifications/read-state/${encodeURIComponent(userId)}`,
      { method: "GET" }
    );

    const parsed = this.parseDate(payload.lastReadAt);
    return parsed || null;
  }

  async markNotificationsAsRead(userId: string): Promise<void> {
    await this.requestJson<{ ok: boolean }>(
      `/api/notifications/read-state/${encodeURIComponent(userId)}`,
      { method: "PUT" }
    );
  }

  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    const numericId = Number(notificationId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      await this.markNotificationsAsRead(userId);
      return;
    }

    await this.requestJson<{ ok: boolean }>(
      `/api/notifications/read-state/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ notificationId: Math.floor(numericId) }),
      }
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    const payload = await this.requestJson<{ count?: number }>(
      `/api/notifications/unread-count/${encodeURIComponent(userId)}`,
      { method: "GET" }
    );
    return Number(payload.count || 0);
  }

  subscribeToUnreadCount(
    userId: string,
    callback: (count: number) => void
  ): () => void {
    let active = true;

    const pull = async () => {
      try {
        const count = await this.getUnreadCount(userId);
        if (!active) return;
        callback(count);
      } catch {
        if (!active) return;
      }
    };

    void pull();
    const interval = window.setInterval(() => void pull(), this.pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }
}

export const notificationsService = new NotificationsService();
