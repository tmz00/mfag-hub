import { Component, Show } from "solid-js";
import { AuthenticatedImage } from "../../../../components/AuthenticatedImage";
import { Button, EditModal, Spinner } from "../../../../components/ui";
import { HandbookEditor } from "../HandbookEditor";
import type { HandbookEntry } from "../handbookTypes";

type Props = {
  title: string;
  draft: HandbookEntry;
  uploadingImage: boolean;
  imageUploadError: string;
  editorUploadingCount: number;
  editorUploadError: string;
  saving: boolean;
  hasChanges: boolean;
  onClose: () => void;
  onCategoryChange: (value: string) => void;
  onImageUpload: (event: Event) => void;
  onRemoveImage: () => void;
  onContentChange: (value: string) => void;
  onUploadError: (message: string) => void;
  onEditorUploadStatusChange: (count: number) => void;
  onSave: () => void;
};

export const HandbookEditModal: Component<Props> = (props) => {
  let imageInputRef: HTMLInputElement | undefined;

  return (
    <EditModal
      title={props.title}
      onClose={() => {
        if (props.saving) return;
        props.onClose();
      }}
      onSave={props.onSave}
      saving={() => props.saving}
      saveDisabled={props.saving || props.uploadingImage || !props.hasChanges}
      bodyClass="pt-6 pb-2"
      footerLeft={
        <div class="flex items-center gap-2">
          <div class="space-y-2 text-base">
            <Show when={props.editorUploadingCount > 0}>
              <div class="flex items-center gap-2 text-gray-500">
                <Spinner class="h-3.5 w-3.5 text-primary/70" />
                Uploading file…
              </div>
            </Show>
            <Show when={props.editorUploadError}>
              <div class="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-medium text-rose-700">
                {props.editorUploadError}
              </div>
            </Show>
          </div>
        </div>
      }
    >
      <div class={`w-full space-y-4 ${props.saving ? "pointer-events-none" : ""}`}>
        <div>
          <label class="mb-1 block text-base font-medium text-gray-700">
            Category name
          </label>
          <input
            type="text"
            value={props.draft.category || ""}
            onInput={(e) => props.onCategoryChange(e.currentTarget.value)}
            disabled={props.saving}
            class="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-base font-medium text-gray-700">
            Category image
          </label>
          <p class="text-sm text-gray-500">
            PNG, JPG, WebP, or GIF. Uploads are only blocked when shared server storage reaches 8 GB.
          </p>
          <div class="mt-2 space-y-3">
            <div class="flex items-center gap-3">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={props.onImageUpload}
                disabled={props.saving || props.uploadingImage}
                class="hidden"
              />
              <Button
                type="button"
                variant="admin"
                size="sm"
                onClick={() => imageInputRef?.click()}
                disabled={props.saving || props.uploadingImage}
              >
                Choose file
              </Button>
              <Button
                variant="adminOutline"
                size="sm"
                onClick={props.onRemoveImage}
                disabled={props.saving || !props.draft.imageUrl || props.uploadingImage}
              >
                Remove
              </Button>
            </div>
            <Show when={props.uploadingImage}>
              <div class="flex items-center gap-2 text-base text-gray-500">
                <Spinner class="h-4 w-4 text-primary/70" />
                Uploading image...
              </div>
            </Show>
            <Show when={props.imageUploadError}>
              <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base text-red-700">
                {props.imageUploadError}
              </div>
            </Show>
            <Show when={props.draft.imageUrl}>
              <div class="relative h-40 overflow-hidden rounded-lg border border-gray-200 bg-gray-900 text-white">
                <AuthenticatedImage
                  src={props.draft.imageUrl}
                  alt="Category preview"
                  class="absolute inset-0 h-full w-full object-cover"
                />
                <div class="absolute inset-0 overflow-hidden bg-linear-to-br from-primary-950 via-primary-800 to-secondary-700 opacity-45">
                  <div class="absolute -left-6 top-3 h-20 w-20 rounded-full bg-secondary-300/20 blur-2xl" />
                  <div class="absolute -right-5 top-1/4 h-24 w-24 rounded-full bg-white/12 blur-2xl" />
                  <div class="absolute -bottom-7 left-1/3 h-28 w-28 rounded-full bg-secondary-200/12 blur-2xl" />
                </div>
                <div class="absolute inset-0 bg-primary/40 mix-blend-multiply" />
                <div class="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-transparent" />
              </div>
            </Show>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-base font-medium text-gray-700">
            Content
          </label>
          <div
            data-handbook-editor-scroll-host="true"
            class="mt-2 relative overflow-visible rounded-lg border border-gray-200 bg-white p-0"
            style={{
              "--handbook-editor-padding": "0px",
              "--handbook-editor-content-padding": "8px",
              "max-height":
                "calc(100dvh - var(--edit-modal-header-height, 0px) - var(--edit-modal-footer-height, 0px))",
              "overflow-y": "auto",
              opacity: props.saving ? 0.7 : 1,
            }}
          >
            <HandbookEditor
              value={props.draft.content || ""}
              onChange={props.onContentChange}
              onUploadError={props.onUploadError}
              onUploadStatusChange={props.onEditorUploadStatusChange}
            />
          </div>
        </div>
      </div>
    </EditModal>
  );
};
