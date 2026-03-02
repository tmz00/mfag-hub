import {
  Component,
  For,
  Show,
  createSignal,
  createResource,
  onMount,
  onCleanup,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineBellRinging,
  TbOutlineInfoCircle,
  TbOutlineCircleCheck,
  TbOutlineAlertTriangle,
  TbOutlineAlertCircle,
  TbOutlinePencil,
  TbOutlineChecks,
} from "solid-icons/tb";
import {
  notificationsService,
  type Notification,
} from "../../../services/notificationsService";
import { authService } from "../../../services/authService";
import { PageShell, PageHeader, Spinner } from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";

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
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const Notifications: Component = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = createSignal<string | null>(null);
  const [lastReadAt, setLastReadAt] = createSignal<Date | null>(null);
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [markingAsRead, setMarkingAsRead] = createSignal(false);

  const [notifications] = createResource(
    () => true,
    async () => {
      return notificationsService.getNotifications(100);
    }
  );

  onMount(() => {
    const unsub = authService.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }
      setUserId(user.uid);

      // Get last read timestamp
      const lastRead = await notificationsService.getUserLastReadAt(user.uid);
      setLastReadAt(lastRead);

      // Check admin status
      const access = String(user.accessLevel || "").toLowerCase();
      setIsAdmin(access === "admin");
    });

    onCleanup(() => unsub && unsub());
  });

  const isUnread = (notification: Notification) => {
    const lastRead = lastReadAt();
    if (!lastRead) return true;
    if (!notification.sentAt) return false;
    return notification.sentAt > lastRead;
  };

  const hasUnread = () => {
    const notifs = notifications();
    if (!notifs) return false;
    return notifs.some((n) => isUnread(n));
  };

  const handleMarkAllAsRead = async () => {
    const uid = userId();
    if (!uid) return;

    setMarkingAsRead(true);
    try {
      await notificationsService.markNotificationsAsRead(uid);
      setLastReadAt(new Date());
    } catch (e) {
      console.error("Failed to mark notifications as read", e);
    } finally {
      setMarkingAsRead(false);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    navigate(`/notifications/${encodeURIComponent(notification.id)}`);
  };

  return (
    <PageShell>
      <PageHeader
        title={dashboardOptions.notifications.title}
        subtitle={dashboardOptions.notifications.description}
        icon={
          <Dynamic
            component={dashboardOptions.notifications.icon}
            class="h-5 w-5"
          />
        }
        onBack={() => navigate(-1)}
      />

      <div class="mx-auto max-w-2xl px-4 py-6">
        <Show
          when={!notifications.loading}
          fallback={
            <div class="flex items-center justify-center py-12">
              <Spinner class="h-8 w-8 text-primary" />
            </div>
          }
        >
          <Show
            when={(notifications() ?? []).length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 text-center">
                <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <TbOutlineBellRinging class="h-8 w-8 text-gray-400" />
                </div>
                <h3 class="text-lg font-semibold text-gray-900">
                  No notifications yet
                </h3>
                <p class="mt-1 text-base text-gray-500">
                  You'll see important updates here
                </p>
              </div>
            }
          >
            <Show when={hasUnread()}>
              <div class="mb-4 flex justify-end">
                <button
                  onClick={handleMarkAllAsRead}
                  disabled={markingAsRead()}
                  class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  <TbOutlineChecks class="h-4 w-4" />
                  {markingAsRead() ? "Marking..." : "Mark all as read"}
                </button>
              </div>
            </Show>
            <div class="space-y-2">
              <For each={notifications()}>
                {(notification) => {
                  const Icon = getNotificationIcon(notification.type);
                  const colorClass = getNotificationColorClass(notification.type);
                  const unread = () => isUnread(notification);

                  return (
                    <div
                      onClick={() => handleNotificationClick(notification)}
                      class={`rounded-xl border p-4 transition-all ${
                        "cursor-pointer hover:shadow-md"
                      } ${
                        unread()
                          ? "border-primary/30 bg-primary/5"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div class="flex gap-3">
                        <div
                          class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}
                        >
                          <Icon class="h-5 w-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-2">
                            <h3
                              class={`text-base ${
                                unread()
                                  ? "font-semibold text-gray-900"
                                  : "font-medium text-gray-700"
                              }`}
                            >
                              {notification.title}
                              <Show when={unread()}>
                                <span class="ml-2 inline-block h-2 w-2 rounded-full bg-primary" />
                              </Show>
                            </h3>
                            <span class="shrink-0 text-sm text-gray-400">
                              {notification.sentAt
                                ? formatDate(notification.sentAt)
                                : "Draft"}
                            </span>
                          </div>
                          <p class="mt-1 text-base text-gray-600 line-clamp-2">
                            {notification.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </PageShell>
  );
};

export default Notifications;
