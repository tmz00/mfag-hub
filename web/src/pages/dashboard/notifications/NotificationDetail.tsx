import { Component, For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import {
  TbOutlineInfoCircle,
  TbOutlineCircleCheck,
  TbOutlineAlertTriangle,
  TbOutlineAlertCircle,
  TbOutlinePaperclip,
  TbOutlineDownload,
} from "solid-icons/tb";
import { PageHeader, PageShell, Spinner } from "../../../components/ui";
import {
  notificationsService,
  type Notification,
  type NotificationAttachment,
} from "../../../services/notificationsService";
import { authService } from "../../../services/authService";

const getNotificationIcon = (type?: Notification["type"]) => {
  switch (type) {
    case "success":
      return TbOutlineCircleCheck;
    case "warning":
      return TbOutlineAlertTriangle;
    case "alert":
      return TbOutlineAlertCircle;
    case "info":
    default:
      return TbOutlineInfoCircle;
  }
};

const getNotificationColorClass = (type?: Notification["type"]) => {
  switch (type) {
    case "success":
      return "text-green-500 bg-green-50";
    case "warning":
      return "text-amber-500 bg-amber-50";
    case "alert":
      return "text-red-500 bg-red-50";
    case "info":
    default:
      return "text-blue-500 bg-blue-50";
  }
};

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[idx]}`;
};

const NotificationDetail: Component = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [userId, setUserId] = createSignal<string | null>(null);
  const [downloadError, setDownloadError] = createSignal("");
  const [downloadingId, setDownloadingId] = createSignal<number | null>(null);

  const [notification] = createResource(
    () => params.id,
    async (id) => {
      if (!id) return null;
      return notificationsService.getNotification(id);
    }
  );

  onMount(() => {
    const unsub = authService.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }

      setUserId(user.uid);

      const notificationId = params.id;
      if (!notificationId) return;

      try {
        await notificationsService.markNotificationAsRead(user.uid, notificationId);
      } catch (error) {
        console.error("Failed to mark notification as read", error);
      }
    });

    onCleanup(() => unsub && unsub());
  });

  const handleDownload = async (attachment: NotificationAttachment) => {
    if (!userId()) return;

    setDownloadError("");
    setDownloadingId(attachment.id);
    try {
      await notificationsService.downloadAttachment(attachment);
    } catch (error) {
      console.error("Failed to download attachment", error);
      setDownloadError("Unable to download attachment right now.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Notification"
        subtitle="Message details"
        onBack={() => navigate(-1)}
      />

      <div class="mx-auto max-w-2xl px-4 py-6">
        <Show
          when={!notification.loading}
          fallback={
            <div class="flex items-center justify-center py-12">
              <Spinner class="h-8 w-8 text-primary" />
            </div>
          }
        >
          <Show
            when={notification()}
            fallback={
              <div class="rounded-xl border border-gray-200 bg-white p-6 text-center">
                <h3 class="text-lg font-semibold text-gray-900">Notification not found</h3>
                <p class="mt-1 text-base text-gray-500">
                  This notification may have been removed.
                </p>
              </div>
            }
          >
            {(item) => {
              const Icon = getNotificationIcon(item().type);
              const colorClass = getNotificationColorClass(item().type);

              return (
                <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div class="flex gap-3">
                    <div
                      class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}
                    >
                      <Icon class="h-5 w-5" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h2 class="text-xl font-semibold text-gray-900">{item().title}</h2>
                      <p class="mt-1 text-sm text-gray-500">
                        {item().sentAt ? formatDate(item().sentAt!) : "Draft"}
                      </p>
                    </div>
                  </div>

                  <p class="mt-5 whitespace-pre-wrap text-base text-gray-700">{item().body}</p>

                  <Show when={item().attachments.length > 0}>
                    <div class="mt-6 border-t border-gray-100 pt-4">
                      <div class="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900">
                        <TbOutlinePaperclip class="h-4 w-4" />
                        Attachments
                      </div>
                      <Show when={downloadError()}>
                        <p class="mb-2 text-sm text-red-600">{downloadError()}</p>
                      </Show>

                      <div class="space-y-2">
                        <For each={item().attachments}>
                          {(attachment) => (
                            <button
                              type="button"
                              onClick={() => void handleDownload(attachment)}
                              disabled={downloadingId() === attachment.id}
                              aria-label={
                                downloadingId() === attachment.id
                                  ? `Downloading ${attachment.name}`
                                  : `Download ${attachment.name}`
                              }
                              class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
                            >
                              <div class="min-w-0 pr-3">
                                <p class="text-base font-medium text-gray-800 break-all whitespace-normal">
                                  {attachment.name}
                                </p>
                                <p class="text-sm text-gray-500">
                                  {formatBytes(attachment.sizeBytes)} • {attachment.mimeType}
                                </p>
                              </div>
                              <span
                                aria-hidden="true"
                                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary"
                              >
                                <TbOutlineDownload
                                  class={`h-4 w-4 ${downloadingId() === attachment.id ? "animate-spin" : ""}`}
                                />
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </Show>
        </Show>
      </div>
    </PageShell>
  );
};

export default NotificationDetail;
