import { A } from "@solidjs/router";
import { Component, For, Show } from "solid-js";
import { TbOutlinePencil } from "solid-icons/tb";

import { AuthenticatedImage } from "./AuthenticatedImage";

export type HandbookCategoryGridItem = {
  id: string;
  label: string;
  imageUrl?: string;
};

type HandbookCategoryGridProps = {
  items: HandbookCategoryGridItem[];
  emptyMessage?: string;
  hrefForId?: (id: string) => string;
  onSelect?: (id: string) => void;
  viewTransitionNameForId?: (id: string) => string;
  showEditBadge?: boolean;
};

export const HandbookCategoryGrid: Component<HandbookCategoryGridProps> = (
  props,
) => {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <p class="text-base text-gray-600">{props.emptyMessage || "No categories yet."}</p>
      }
    >
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <For each={props.items}>
          {(item) => {
            const content = (
              <>
                <Show when={item.imageUrl}>
                  {(url) => (
                    <AuthenticatedImage
                      src={url()}
                      alt={item.label || "Handbook category image"}
                      class="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </Show>
                <div
                  class="absolute inset-0 overflow-hidden bg-linear-to-br from-primary-950 via-primary-800 to-secondary-700"
                  classList={{ "opacity-45": !!item.imageUrl }}
                >
                  <div class="absolute -left-6 top-3 h-20 w-20 rounded-full bg-secondary-300/20 blur-2xl" />
                  <div class="absolute -right-5 top-1/4 h-24 w-24 rounded-full bg-white/12 blur-2xl" />
                  <div class="absolute -bottom-7 left-1/3 h-28 w-28 rounded-full bg-secondary-200/12 blur-2xl" />
                </div>
                <div class="absolute inset-0 bg-primary/40 mix-blend-multiply" />
                <div class="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-transparent" />
                <Show when={props.showEditBadge}>
                  <div class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm ring-1 ring-black/10">
                    <TbOutlinePencil class="h-4 w-4" />
                  </div>
                </Show>
                <div class="relative flex flex-1 items-center justify-center p-4 text-center">
                  <p
                    class="text-base font-semibold leading-tight text-white"
                    style="text-shadow: 0 2px 4px rgba(0,0,0,0.6);"
                  >
                    {item.label || "Untitled"}
                  </p>
                </div>
                <div class="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/5 transition group-hover:ring-white/15" />
              </>
            );

            const commonClass =
              "group relative flex h-36 flex-col overflow-hidden rounded-xl border border-gray-100 bg-gray-900 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0";

            const viewTransitionName = props.viewTransitionNameForId?.(item.id);
            const style = viewTransitionName
              ? `view-transition-name: ${viewTransitionName};`
              : undefined;

            if (props.hrefForId) {
              return (
                <A
                  href={props.hrefForId(item.id)}
                  class={commonClass}
                  style={style}
                >
                  {content}
                </A>
              );
            }

            return (
              <button
                type="button"
                class={`${commonClass} cursor-pointer text-left`}
                onClick={() => props.onSelect?.(item.id)}
                style={style}
              >
                {content}
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
};
