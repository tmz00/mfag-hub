import { Component, Show, Index, createSignal, createMemo } from "solid-js";
import {
  TbOutlinePlus,
  TbOutlineTrash,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
} from "solid-icons/tb";
import {
  Button,
  EditModal,
  IconButton,
  createConfirm,
} from "../../../../components/ui";
import { productsService, type ProductCatalog } from "../../../../services/productsService";
import { toTypeRows, normalizeTypeRows, type TypeRow } from "./types";

type Props = {
  catalog: ProductCatalog;
  onClose: () => void;
  onSaved: (updated: ProductCatalog) => void;
  onError: (message: string) => void;
};

const ProductGSTTypesModal: Component<Props> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [animating, setAnimating] = createSignal<
    Record<number, "up" | "down">
  >({});
  const [gstInput, setGstInput] = createSignal<number | "">(
    typeof props.catalog.gst === "number" ? props.catalog.gst : ""
  );
  const [typeRows, setTypeRows] = createSignal<TypeRow[]>(
    toTypeRows(props.catalog.types)
  );

  const initialSnapshot = JSON.stringify({
    gst: typeof props.catalog.gst === "number" ? props.catalog.gst : "",
    types: toTypeRows(props.catalog.types),
  });

  const currentSnapshot = () =>
    JSON.stringify({
      gst: gstInput(),
      types: typeRows(),
    });

  const hasUnsavedChanges = () => currentSnapshot() !== initialSnapshot;

  const isValid = createMemo(() => {
    const rows = typeRows();
    return rows.every((row) => row.key.trim() && row.label.trim());
  });

  const [DeleteTypeModal, confirmDeleteType] = createConfirm({
    title: "Delete type?",
    confirmLabel: "Delete",
    variant: "danger",
  });

  const handleDeleteType = async (index: number) => {
    const row = typeRows()[index];
    if (!row) return;

    const name = row.label.trim() || row.key.trim() || "this type";
    const confirmed = await confirmDeleteType({
      message: `This will remove "${name}" from the type definitions list.`,
    });
    if (!confirmed) return;

    setTypeRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const moveTypeRow = (fromIndex: number, toIndex: number) => {
    setTypeRows((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const direction = toIndex < fromIndex ? "up" : "down";
      const opposite = direction === "up" ? "down" : "up";
      window.setTimeout(() => setAnimating({}), 320);
      setAnimating({
        [fromIndex]: direction,
        [toIndex]: opposite,
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!isValid()) return;
    setSaving(true);
    try {
      const updated: ProductCatalog = {
        ...props.catalog,
        gst: gstInput() === "" ? undefined : Number(gstInput()),
        types: normalizeTypeRows(typeRows()),
      };
      await productsService.setProducts(updated, "Edit GST / Type Definitions");
      props.onSaved(updated);
    } catch (err) {
      console.error("Failed to save GST/types", err);
      props.onError(
        err instanceof Error && err.message.trim()
          ? err.message
          : "Unable to save GST and type definitions."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal
      title="Edit GST/Type Definitions"
      onClose={props.onClose}
      onSave={handleSave}
      saving={() => saving()}
      saveDisabled={saving() || !isValid() || !hasUnsavedChanges()}
      hasUnsavedChanges={hasUnsavedChanges}
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-base font-medium text-gray-700">
            GST
          </label>
          <input
            type="number"
            min="0"
            value={gstInput()}
            onInput={(e) =>
              setGstInput(
                e.currentTarget.value === ""
                  ? ""
                  : Number(e.currentTarget.value)
              )
            }
            placeholder="e.g. 9"
            class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
          />
        </div>

        <div>
          <div class="mb-2">
            <label class="text-base font-medium text-gray-700">Types</label>
          </div>
          <div class="overflow-hidden rounded-lg border border-gray-200">
            <Show
              when={typeRows().length}
              fallback={<p class="text-sm text-gray-500">No types defined.</p>}
            >
              <Index each={typeRows()}>
                {(row, index) => (
                  <div
                    class={`flex flex-row gap-1 border-b border-gray-200 px-3 py-2 last:border-b-0 ${
                      index % 2 === 0 ? "bg-admin-from/5" : "bg-admin-from/10"
                    } ${
                      animating()[index] === "up"
                        ? "reorder-move-up"
                        : animating()[index] === "down"
                          ? "reorder-move-down"
                          : ""
                    }`}
                  >
                    <input
                      type="text"
                      placeholder="tag"
                      value={row().key}
                      onInput={(e) =>
                        setTypeRows((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, key: e.currentTarget.value }
                              : item
                          )
                        )
                      }
                      class="w-20 rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                    />
                    <input
                      type="text"
                      placeholder="type"
                      value={row().label}
                      onInput={(e) =>
                        setTypeRows((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, label: e.currentTarget.value }
                              : item
                          )
                        )
                      }
                      class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                    />
                    <IconButton
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => moveTypeRow(index, index - 1)}
                      disabled={index === 0}
                      class="h-10 w-10 rounded-lg text-gray-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Move type up"
                    >
                      <TbOutlineArrowUp class="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => moveTypeRow(index, index + 1)}
                      disabled={index === typeRows().length - 1}
                      class="h-10 w-10 rounded-lg text-gray-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Move type down"
                    >
                      <TbOutlineArrowDown class="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        void handleDeleteType(index);
                      }}
                      class="h-10 w-10 rounded-lg text-red-600 hover:bg-red-50"
                      aria-label="Remove type"
                    >
                      <TbOutlineTrash class="h-4 w-4" />
                    </IconButton>
                  </div>
                )}
              </Index>
            </Show>
          </div>
          <div class="mt-3 flex justify-center">
            <Button
              type="button"
              variant="adminOutline"
              size="sm"
              onClick={() =>
                setTypeRows((prev) => [...prev, { key: "", label: "" }])
              }
              class="rounded-full text-sm font-semibold"
            >
              <TbOutlinePlus class="h-3.5 w-3.5" />
              Add type
            </Button>
          </div>
        </div>

      </div>
      <DeleteTypeModal />
    </EditModal>
  );
};

export default ProductGSTTypesModal;
