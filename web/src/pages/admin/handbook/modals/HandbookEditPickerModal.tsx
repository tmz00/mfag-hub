import { Component, For, Show } from "solid-js";
import { TbOutlinePencil, TbOutlineTrash } from "solid-icons/tb";

import { AuthenticatedImage } from "../../../../components/AuthenticatedImage";
import { EditModal, IconButton } from "../../../../components/ui";
import type { HandbookEntry } from "../handbookTypes";

type Props = {
  entries: HandbookEntry[];
  onClose: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
};

export const HandbookEditPickerModal: Component<Props> = (props) => {
  return (
    <EditModal
      title="Choose the category to edit"
      onClose={props.onClose}
      bodyClass="pb-6 pt-4"
    >
      <Show
        when={props.entries.length > 0}
        fallback={<p class="text-base text-gray-600">No categories available.</p>}
      >
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
          <For each={props.entries}>
            {(entry, index) => (
              <div class="group relative flex h-36 flex-col overflow-hidden rounded-xl border border-gray-100 bg-gray-900 text-white shadow-sm">
                <Show when={entry.imageUrl}>
                  {(url) => (
                    <AuthenticatedImage
                      src={url()}
                      alt={entry.category || "Handbook category image"}
                      class="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </Show>
                <div
                  class="absolute inset-0 overflow-hidden bg-linear-to-br from-primary-950 via-primary-800 to-secondary-700"
                  classList={{ "opacity-45": !!entry.imageUrl }}
                >
                  <div class="absolute -left-6 top-3 h-20 w-20 rounded-full bg-secondary-300/20 blur-2xl" />
                  <div class="absolute -right-5 top-1/4 h-24 w-24 rounded-full bg-white/12 blur-2xl" />
                  <div class="absolute -bottom-7 left-1/3 h-28 w-28 rounded-full bg-secondary-200/12 blur-2xl" />
                </div>
                <div class="absolute inset-0 bg-primary/40 mix-blend-multiply" />
                <div class="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-transparent" />
                <div class="absolute right-2 top-2 z-10 flex items-center gap-2">
                  <IconButton
                    type="button"
                    variant="adminOutline"
                    onClick={() => props.onEdit(index())}
                    class="bg-white/90 hover:bg-white"
                    aria-label="Edit category"
                  >
                    <TbOutlinePencil class="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant="default"
                    onClick={() => props.onDelete(index())}
                    class="border border-gray-300 bg-white/90 text-red-600 hover:bg-white"
                    aria-label="Delete category"
                  >
                    <TbOutlineTrash class="h-4 w-4" />
                  </IconButton>
                </div>
                <div class="relative flex flex-1 items-center justify-center p-4 text-center">
                  <p
                    class="text-base font-semibold leading-tight text-white"
                    style="text-shadow: 0 2px 4px rgba(0,0,0,0.6);"
                  >
                    {entry.category || "Untitled"}
                  </p>
                </div>
                <div class="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/5" />
              </div>
            )}
          </For>
        </div>
      </Show>
    </EditModal>
  );
};
