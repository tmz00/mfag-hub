import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
  createResource,
  onMount,
  onCleanup,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineBell,
  TbOutlinePlus,
  TbOutlinePencil,
  TbOutlineTrash,
  TbOutlineSend,
  TbOutlineInfoCircle,
  TbOutlineCircleCheck,
  TbOutlineAlertTriangle,
  TbOutlineAlertCircle,
  TbOutlinePaperclip,
} from "solid-icons/tb";
import {
  PageShell,
  PageHeader,
  Button,
  IconButton,
  EditModal,
  Spinner,
  createConfirm,
} from "../../../components/ui/";
import {
  notificationsService,
  type Notification,
  type NotificationAttachment,
  type NotificationInput,
} from "../../../services/notificationsService";
import { authService } from "../../../services/authService";
import { adminOptionForPath } from "../adminOptions";

const notificationTypes = [
  { value: "info", label: "Info", icon: TbOutlineInfoCircle, colorClass: "text-blue-500" },
  { value: "success", label: "Success", icon: TbOutlineCircleCheck, colorClass: "text-green-500" },
  { value: "warning", label: "Warning", icon: TbOutlineAlertTriangle, colorClass: "text-amber-500" },
  { value: "alert", label: "Alert", icon: TbOutlineAlertCircle, colorClass: "text-red-500" },
] as const;

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

const ManageNotifications: Component = () => {
  const location = useLocation();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const navigate = useNavigate();
  const [userId, setUserId] = createSignal<string | null>(null);
  const [userName, setUserName] = createSignal<string>("");
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [showModal, setShowModal] = createSignal(false);
  const [editingNotification, setEditingNotification] = createSignal<Notification | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal<string | null>(null);
  const [pendingRemovedAttachmentIds, setPendingRemovedAttachmentIds] = createSignal<number[]>([]);
  const [previewingAttachmentId, setPreviewingAttachmentId] = createSignal<number | null>(null);
  const [previewErrorNotificationId, setPreviewErrorNotificationId] = createSignal<string | null>(
    null
  );
  const [previewError, setPreviewError] = createSignal("");

  // Form state
  const [formTitle, setFormTitle] = createSignal("");
  const [formBody, setFormBody] = createSignal("");
  const [formType, setFormType] = createSignal<Notification["type"]>("info");
  const [formAttachments, setFormAttachments] = createSignal<NotificationAttachment[]>([]);
  const [queuedAttachments, setQueuedAttachments] = createSignal<File[]>([]);
  const [attachmentError, setAttachmentError] = createSignal("");

  const [notifications, { refetch }] = createResource(
    () => isAdmin(),
    async (admin) => {
      if (!admin) return [];
      return notificationsService.getAllNotificationsForAdmin();
    }
  );

  onMount(() => {
    const unsub = authService.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }
      setUserId(user.uid);
      setUserName(user.fullName || user.nickname || user.email || "Unknown");

      // Check admin status
      const adminStatus = String(user.accessLevel || "").toLowerCase() === "admin";
      setIsAdmin(adminStatus);

      if (!adminStatus) {
        navigate("/notifications", { replace: true });
      }
    });

    onCleanup(() => unsub && unsub());
  });

  const canModifyAttachments = () => {
    const editing = editingNotification();
    if (!editing) return true;
    return !editing.sentAt;
  };

  const resetModalState = () => {
    setAttachmentError("");
    setFormAttachments([]);
    setQueuedAttachments([]);
    setPendingRemovedAttachmentIds([]);
  };

  const openCreateModal = () => {
    setEditingNotification(null);
    setFormTitle("");
    setFormBody("");
    setFormType("info");
    resetModalState();
    setShowModal(true);
  };

  const openEditModal = (notification: Notification) => {
    if (notification.sentAt) return;

    setEditingNotification(notification);
    setFormTitle(notification.title);
    setFormBody(notification.body);
    setFormType(notification.type || "info");
    setFormAttachments(notification.attachments || []);
    setQueuedAttachments([]);
    setAttachmentError("");
    setPendingRemovedAttachmentIds([]);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingNotification(null);
    resetModalState();
  };

  const handleAttachmentInput = (event: Event & { currentTarget: HTMLInputElement }) => {
    if (!canModifyAttachments()) return;

    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length) return;
    setQueuedAttachments((current) => [...current, ...files]);
    setAttachmentError("");
  };

  const removeQueuedAttachment = (index: number) => {
    setQueuedAttachments((current) => current.filter((_, idx) => idx !== index));
    setAttachmentError("");
  };

  const removeExistingAttachment = (attachment: NotificationAttachment) => {
    if (!canModifyAttachments()) return;
    setPendingRemovedAttachmentIds((ids) => [...ids, attachment.id]);
    setFormAttachments((current) =>
      current.filter((a) => a.id !== attachment.id)
    );
    setAttachmentError("");
  };

  const handleAttachmentPreview = async (
    notificationId: string,
    attachment: NotificationAttachment
  ) => {
    setPreviewError("");
    setPreviewErrorNotificationId(null);
    setPreviewingAttachmentId(attachment.id);

    try {
      await notificationsService.previewAttachment(attachment);
    } catch (error: any) {
      console.error("Failed to preview attachment", error);
      setPreviewErrorNotificationId(notificationId);
      setPreviewError("Unable to open attachment preview right now.");
    } finally {
      setPreviewingAttachmentId(null);
    }
  };

  const saveAndUploadQueuedAttachments = async (
    notificationId: string,
    sendImmediately: boolean
  ) => {
    const pending = [...queuedAttachments()];
    if (pending.length > 0) {
      const uploaded: NotificationAttachment[] = [];
      for (let index = 0; index < pending.length; index += 1) {
        const file = pending[index];
        try {
          const attachment = await notificationsService.uploadAttachment(notificationId, file);
          uploaded.push(attachment);
        } catch (error) {
          setQueuedAttachments(pending.slice(index));
          if (uploaded.length > 0) {
            setFormAttachments((current) => [...current, ...uploaded]);
          }
          throw error;
        }
      }
      setFormAttachments((current) => [...current, ...uploaded]);
      setQueuedAttachments([]);
    }

    if (sendImmediately) {
      await notificationsService.sendNotification(notificationId);
    }
  };

  const handleSave = async (sendImmediately: boolean = false) => {
    const title = formTitle().trim();
    const body = formBody().trim();
    const editing = editingNotification();
    let targetNotificationId: string | null = editing?.id || null;
    let createdThisAttempt = false;

    if (!title || !body) return;

    setSaving(true);
    setAttachmentError("");

    try {
      const input: NotificationInput = {
        title,
        body,
        type: formType() || "info",
        createdBy: userId() || "",
        createdByName: userName(),
      };

      if (editing) {
        await notificationsService.updateNotification(editing.id, input);
        targetNotificationId = editing.id;
      } else {
        targetNotificationId = await notificationsService.createNotification(input);
        createdThisAttempt = true;
      }

      const removedIds = pendingRemovedAttachmentIds();
      for (const fileId of removedIds) {
        try {
          await notificationsService.deleteAttachment(targetNotificationId!, fileId);
        } catch (e) {
          console.error("Failed to delete attachment", e);
        }
      }
      setPendingRemovedAttachmentIds([]);

      const shouldSend = sendImmediately && !(editing && editing.sentAt);
      await saveAndUploadQueuedAttachments(targetNotificationId!, shouldSend);

      closeModal();
      refetch();
    } catch (error: any) {
      console.error("Failed to save notification", error);
      const message = error?.message || "Unable to save notification.";

      if (createdThisAttempt && targetNotificationId) {
        try {
          const createdDraft = await notificationsService.getNotification(targetNotificationId);
          if (createdDraft) {
            setEditingNotification(createdDraft);
            setFormAttachments(createdDraft.attachments);
          } else {
            setEditingNotification({
              id: targetNotificationId,
              title,
              body,
              createdAt: new Date(),
              createdBy: userId() || "",
              createdByName: userName(),
              type: formType() || undefined,
              attachments: formAttachments(),
            });
          }
        } catch {
          setEditingNotification({
            id: targetNotificationId,
            title,
            body,
            createdAt: new Date(),
            createdBy: userId() || "",
            createdByName: userName(),
            type: formType() || undefined,
            attachments: formAttachments(),
          });
        }

        setAttachmentError(`${message} Draft was created. Please retry to finish.`);
        return;
      }

      setAttachmentError(message);
    } finally {
      setSaving(false);
    }
  };

  const [DeleteNotificationModal, confirmDeleteNotification] = createConfirm({
    title: "Delete notification",
    message: "Are you sure you want to delete this notification?",
    confirmLabel: "Delete",
    variant: "danger",
  });

  const [SendNotificationModal, confirmSendNotification] = createConfirm({
    title: "Send notification",
    message: "Send this notification to all users now?",
    confirmLabel: "Send",
  });

  const handleDelete = async (id: string) => {
    if (!(await confirmDeleteNotification())) return;

    setDeleting(id);
    try {
      await notificationsService.deleteNotification(id);
      refetch();
    } catch (e) {
      console.error("Failed to delete notification", e);
    } finally {
      setDeleting(null);
    }
  };

  const handleSend = async (id: string) => {
    if (!(await confirmSendNotification())) return;

    setSending(id);
    try {
      await notificationsService.sendNotification(id);
      refetch();
    } catch (e) {
      console.error("Failed to send notification", e);
    } finally {
      setSending(null);
    }
  };

  const getTypeInfo = (type?: Notification["type"]) => {
    return notificationTypes.find((t) => t.value === type) || notificationTypes[0];
  };

  const isSaveDisabled = () =>
    saving() ||
    !formTitle().trim() ||
    !formBody().trim();

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        title={adminOption().title}
        subtitle={adminOption().description}
        icon={
          <Dynamic
            component={adminOption().icon}
            class="h-5 w-5"
          />
        }
        onBack={() => navigate(-1)}
      />

      <div class="mx-auto px-4 py-6">
        <div class="mb-4 flex justify-center">
          <Button
            onClick={openCreateModal}
            variant="admin"
            size="md"
            class="rounded-lg"
          >
            <TbOutlinePlus class="h-4 w-4" />
            Create New Notification
          </Button>
        </div>

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
              <div class="flex flex-col items-center justify-center py-12 text-center">
                <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <TbOutlineBell class="h-8 w-8 text-gray-400" />
                </div>
                <h3 class="text-lg font-semibold text-gray-900">
                  No notifications yet
                </h3>
                <p class="mt-1 text-base text-gray-500">
                  Create your first notification using the button above
                </p>
              </div>
            }
          >
            <div class="space-y-3">
              <For each={notifications()}>
                {(notification) => {
                  const typeInfo = getTypeInfo(notification.type);
                  const Icon = typeInfo.icon;
                  const isDraft = !notification.sentAt;

                  return (
                    <div
                      class={`rounded-xl border p-4 ${
                        isDraft
                          ? "border-dashed border-gray-300 bg-gray-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div class="flex gap-3">
                        <div
                          class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                            isDraft ? "bg-gray-200" : "bg-gray-100"
                          }`}
                        >
                          <Icon class={`h-5 w-5 ${typeInfo.colorClass}`} />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                              <h3 class="text-base font-semibold text-gray-900">
                                {notification.title}
                                <Show when={isDraft}>
                                  <span class="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-700">
                                    Draft
                                  </span>
                                </Show>
                              </h3>
                              <p class="mt-1 text-base text-gray-600 line-clamp-2">
                                {notification.body}
                              </p>
                            </div>
                            <div class="flex shrink-0 items-start gap-2">
                              <Show when={isDraft}>
                                <Button
                                  type="button"
                                  variant="adminOutline"
                                  onClick={() => handleSend(notification.id)}
                                  disabled={sending() === notification.id}
                                  size="sm"
                                  class="rounded-full"
                                >
                                  <TbOutlineSend class="h-3.5 w-3.5" />
                                  {sending() === notification.id ? "Sending..." : "Send Now"}
                                </Button>
                                <IconButton
                                  type="button"
                                  variant="adminOutline"
                                  onClick={() => openEditModal(notification)}
                                  title="Edit notification"
                                  aria-label="Edit notification"
                                >
                                  <TbOutlinePencil class="h-4 w-4" />
                                </IconButton>
                              </Show>
                              <IconButton
                                type="button"
                                variant="danger"
                                onClick={() => handleDelete(notification.id)}
                                disabled={deleting() === notification.id}
                                class="border-red-500 text-red-600"
                                title="Delete notification"
                                aria-label={
                                  deleting() === notification.id
                                    ? "Deleting notification"
                                    : "Delete notification"
                                }
                              >
                                <TbOutlineTrash class="h-4 w-4" />
                              </IconButton>
                            </div>
                          </div>
                          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
                            <span>
                              Created {formatDate(notification.createdAt)}
                            </span>
                            <Show when={notification.sentAt}>
                              <span>
                                Sent {formatDate(notification.sentAt!)}
                              </span>
                            </Show>
                            <Show when={notification.createdByName}>
                              <span>by {notification.createdByName}</span>
                            </Show>
                          </div>
                          <Show when={notification.attachments.length > 0}>
                            <div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                              <div class="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                                <TbOutlinePaperclip class="h-4 w-4" />
                                Attachments
                              </div>
                              <Show
                                when={
                                  previewErrorNotificationId() === notification.id && previewError()
                                }
                              >
                                <p class="mb-2 text-sm text-red-600">{previewError()}</p>
                              </Show>
                              <div class="space-y-2">
                                <For each={notification.attachments}>
                                  {(attachment) => (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleAttachmentPreview(notification.id, attachment)
                                      }
                                      disabled={previewingAttachmentId() === attachment.id}
                                      aria-label={
                                        previewingAttachmentId() === attachment.id
                                          ? `Opening ${attachment.name}`
                                          : `Preview ${attachment.name}`
                                      }
                                      class="flex w-full items-center justify-between rounded-lg border border-white bg-white px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-60"
                                    >
                                      <div class="min-w-0 pr-3">
                                        <p class="text-sm font-medium text-gray-800 break-all whitespace-normal">
                                          {attachment.name}
                                        </p>
                                        <p class="text-xs text-gray-500">
                                          {formatBytes(attachment.sizeBytes)} • {attachment.mimeType}
                                        </p>
                                      </div>
                                      <span class="shrink-0 text-xs font-medium text-primary">
                                        {previewingAttachmentId() === attachment.id
                                          ? "Opening..."
                                          : "Preview"}
                                      </span>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
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

      <Show when={showModal()}>
        <EditModal
          title={editingNotification() ? "Edit Notification" : "New Notification"}
          onClose={() => {
            if (saving()) return;
            closeModal();
          }}
          onSave={() => void handleSave(true)}
          saving={() => saving()}
          saveDisabled={isSaveDisabled()}
          saveLabel={editingNotification()?.sentAt ? "Update" : "Save & Send"}
          savingLabel="Saving..."
          footerLeft={
            <Show when={!editingNotification()?.sentAt}>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void handleSave(false)}
                disabled={isSaveDisabled()}
              >
                {saving() ? "Saving..." : "Save as Draft"}
              </Button>
            </Show>
          }
        >
          <div class="space-y-4">
            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Title <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formTitle()}
                onInput={(e) => setFormTitle(e.currentTarget.value)}
                placeholder="Notification title"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Message <span class="text-red-500">*</span>
              </label>
              <textarea
                value={formBody()}
                onInput={(e) => setFormBody(e.currentTarget.value)}
                placeholder="Notification message"
                rows={4}
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Type
              </label>
              <div class="flex flex-wrap gap-2">
                <For each={notificationTypes}>
                  {(type) => {
                    const Icon = type.icon;
                    return (
                      <Button
                        type="button"
                        variant={formType() === type.value ? "primarySoft" : "secondary"}
                        size="sm"
                        onClick={() => setFormType(type.value)}
                        class="rounded-lg px-3 py-1.5 text-base font-medium"
                      >
                        <Icon class={`h-4 w-4 ${type.colorClass}`} />
                        {type.label}
                      </Button>
                    );
                  }}
                </For>
              </div>
            </div>

            <div>
              <div class="mb-1 flex items-center gap-1 text-base font-medium text-gray-700">
                <TbOutlinePaperclip class="h-4 w-4" />
                Attachments
              </div>
              <Show
                when={canModifyAttachments()}
                fallback={
                  <p class="text-sm text-gray-500">
                    Attachments cannot be changed after a notification is sent.
                  </p>
                }
              >
                <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                  <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                    <TbOutlinePlus class="h-4 w-4" />
                    Add files
                    <input
                      type="file"
                      multiple
                      class="hidden"
                      onChange={handleAttachmentInput}
                      disabled={saving()}
                    />
                  </label>
                  <p class="mt-2 text-sm text-gray-500">
                    No per-file limit. Uploads are only blocked when shared server storage reaches 8 GB.
                  </p>
                  <Show when={!editingNotification()}>
                    <p class="mt-1 text-sm text-amber-700">
                      Files selected here will upload when you save.
                    </p>
                  </Show>
                </div>
              </Show>

              <Show when={attachmentError()}>
                <p class="mt-2 text-sm text-red-600">{attachmentError()}</p>
              </Show>

              <Show when={formAttachments().length > 0 || queuedAttachments().length > 0}>
                <div class="mt-2 space-y-2">
                  <For each={formAttachments()}>
                    {(attachment) => (
                      <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <div class="min-w-0 pr-3">
                          <p class="truncate text-sm font-medium text-gray-800">{attachment.name}</p>
                          <p class="text-sm text-gray-500">
                            {formatBytes(attachment.sizeBytes)} • {attachment.mimeType}
                          </p>
                        </div>
                        <Show when={canModifyAttachments()}>
                          <IconButton
                            type="button"
                            variant="danger"
                            aria-label="Remove attachment"
                            onClick={() => removeExistingAttachment(attachment)}
                            disabled={saving()}
                          >
                            <TbOutlineTrash class="h-4 w-4" />
                          </IconButton>
                        </Show>
                      </div>
                    )}
                  </For>

                  <For each={queuedAttachments()}>
                    {(file, index) => (
                      <div class="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                        <div class="min-w-0 pr-3">
                          <p class="truncate text-sm font-medium text-gray-800">{file.name}</p>
                          <p class="text-sm text-gray-500">
                            {formatBytes(file.size)} • Pending upload
                          </p>
                        </div>
                        <Show when={canModifyAttachments()}>
                          <IconButton
                            type="button"
                            variant="danger"
                            aria-label="Remove attachment"
                            onClick={() => removeQueuedAttachment(index())}
                            disabled={saving()}
                          >
                            <TbOutlineTrash class="h-4 w-4" />
                          </IconButton>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </EditModal>
      </Show>

      <DeleteNotificationModal />
      <SendNotificationModal />
    </PageShell>
  );
};

export default ManageNotifications;
