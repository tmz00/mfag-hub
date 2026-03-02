import { For, Show, createSignal, type JSX } from "solid-js";
import { TbOutlineArrowUp, TbOutlineArrowDown } from "solid-icons/tb";
import { IconButton } from "./IconButton";

type ReorderListProps<T> = {
  items: T[];
  itemKey: (item: T) => string;
  renderLabel: (item: T, index: number) => JSX.Element;
  renderExpanded?: (item: T, index: number) => JSX.Element | false | undefined | null;
  onMove: (fromIndex: number, toIndex: number) => void;
  onItemClick?: (item: T, index: number) => void;
  class?: string;
  emptyMessage?: string;
};

export function ReorderList<T>(props: ReorderListProps<T>) {
  const [animating, setAnimating] = createSignal<Record<string, "up" | "down">>(
    {},
  );

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= props.items.length) return;
    const movedKey = props.itemKey(props.items[index]);
    const displacedKey = props.itemKey(props.items[targetIndex]);
    const opposite = direction === "up" ? "down" : "up";
    setAnimating({ [movedKey]: direction, [displacedKey]: opposite });
    window.setTimeout(() => setAnimating({}), 320);
    props.onMove(index, targetIndex);
  };

  return (
    <Show
      when={props.items.length > 0}
      fallback={
        props.emptyMessage ? (
          <div class="text-base text-gray-600">{props.emptyMessage}</div>
        ) : null
      }
    >
      <div class={props.class ?? "border border-gray-200"}>
        <For each={props.items}>
          {(item, index) => {
            const dir = () => animating()[props.itemKey(item)];
            return (
              <div class="overflow-hidden border-b border-gray-200 last:border-b-0">
                <div
                  role={props.onItemClick ? "button" : undefined}
                  tabIndex={props.onItemClick ? 0 : undefined}
                  onClick={
                    props.onItemClick
                      ? () => props.onItemClick!(item, index())
                      : undefined
                  }
                  onKeyDown={
                    props.onItemClick
                      ? (e: KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            props.onItemClick!(item, index());
                          }
                        }
                      : undefined
                  }
                  class={`flex w-full items-center px-3 py-2 text-left ${
                    index() % 2 === 0 ? "bg-admin-from/5" : "bg-admin-from/10"
                  } ${
                    dir() === "up"
                      ? "reorder-move-up"
                      : dir() === "down"
                        ? "reorder-move-down"
                        : ""
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <IconButton
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(index(), "up");
                      }}
                      disabled={index() === 0}
                      class="h-6 w-6 rounded-lg border border-gray-300 text-gray-500 hover:bg-white"
                      aria-label="Move up"
                    >
                      <TbOutlineArrowUp class="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(index(), "down");
                      }}
                      disabled={index() === props.items.length - 1}
                      class="h-6 w-6 rounded-lg border border-gray-300 text-gray-500 hover:bg-white"
                      aria-label="Move down"
                    >
                      <TbOutlineArrowDown class="h-4 w-4" />
                    </IconButton>
                  </div>
                  <div class="min-w-0 flex-1 pl-3">
                    {props.renderLabel(item, index())}
                  </div>
                </div>
                {props.renderExpanded?.(item, index())}
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
