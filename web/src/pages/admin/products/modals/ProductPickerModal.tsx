import { Component, Show, createMemo, type JSX } from "solid-js";
import { TbOutlinePencil, TbOutlineTrash } from "solid-icons/tb";
import { EditModal, IconButton, createConfirm } from "../../../../components/ui";
import ProductCatalogBrowser from "../../../../components/ProductCatalogBrowser";
import type { BasePlan, Rider, ProductCatalog } from "../../../../services/productsService";
import type { TabKey, ProductItem } from "./types";

type Props = {
  catalog: ProductCatalog;
  onClose: () => void;
  onEditProduct: (tab: TabKey, item: ProductItem, index: number) => void;
  onDeleteProduct: (tab: TabKey, item: ProductItem, index: number) => void;
};

const ProductPickerModal: Component<Props> = (props) => {
  const [DeleteModal, confirmDelete] = createConfirm({
    title: "Delete product",
    confirmLabel: "Delete",
    variant: "danger",
  });
  const basePlans = createMemo<BasePlan[]>(() => props.catalog.basePlans || []);
  const riders = createMemo<Rider[]>(() => props.catalog.riders || []);

  const allBasePlans = () => props.catalog.basePlans || [];
  const allRiders = () => props.catalog.riders || [];
  const handleDeleteProduct = async (
    tab: TabKey,
    item: ProductItem,
    index: number,
  ) => {
    if (index < 0) return;
    const name = item.shortName || item.fullName || item.id;
    const confirmed = await confirmDelete({ message: `Delete ${name}?` });
    if (!confirmed) return;
    props.onDeleteProduct(tab, item, index);
  };

  const renderItem = (
    item: ProductItem,
    _localIndex: number,
    tab: TabKey,
    highlight: (text: string) => JSX.Element,
  ): JSX.Element => {
    const allItems = tab === "riders" ? allRiders() : allBasePlans();
    const globalIndex = allItems.indexOf(item);

    return (
      <div class="flex w-full items-center gap-2 border-b border-gray-300 p-3 text-left transition-colors hover:bg-admin-from/5">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-base font-medium text-gray-900">
              {highlight(item.fullName || "Unnamed Product")}
            </span>
            <Show when={item.shortName}>
              <span class="rounded bg-admin-from/10 px-1.5 py-0.5 text-sm text-admin-from">
                {highlight(item.shortName || "")}
              </span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <IconButton
            type="button"
            variant="adminOutline"
            aria-label="Edit product"
            onClick={() => props.onEditProduct(tab, item, globalIndex)}
          >
            <TbOutlinePencil class="h-4 w-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="default"
            class="border border-gray-300 text-red-600 hover:bg-red-50"
            aria-label="Delete product"
            onClick={() => handleDeleteProduct(tab, item, globalIndex)}
          >
            <TbOutlineTrash class="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    );
  };

  return (
    <EditModal title="Choose plan to edit" onClose={props.onClose} bodyClass="pb-6">
      <ProductCatalogBrowser
        basePlans={basePlans()}
        riders={riders()}
        accentColor="admin"
        renderItem={renderItem}
      />
      <DeleteModal />
    </EditModal>
  );
};

export default ProductPickerModal;
