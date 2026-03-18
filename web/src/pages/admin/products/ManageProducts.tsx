import {
  Component,
  Show,
  createSignal,
  createMemo,
  onMount,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";

import {
  PageShell,
  PageHeader,
  PageBody,
  ConfirmModal,
  LoadingState,
} from "../../../components/ui";
import { getCaptchaAwareErrorMessage } from "../../../services/authService";
import {
  productsService,
  type BasePlan,
  type Rider,
  type ProductCatalog,
} from "../../../services/productsService";
import { teamService } from "../../../services/teamService";
import {
  ProductGSTTypesModal,
  ProductPickerModal,
  ProductEditorModal,
  ProductReorderModal,
  type TabKey,
  type ProductItem,
} from "./modals";
import {
  adminActionButtonClass,
  adminOptionForPath,
  manageProductsActionOptions,
} from "../adminOptions";
import { formatProductChangeSnapshotTitle } from "./snapshotTitles";

const ManageProducts: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const [accessError, setAccessError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [catalog, setCatalog] = createSignal<ProductCatalog | null>(null);

  // Modal states
  const [showGSTTypesModal, setShowGSTTypesModal] = createSignal(false);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [showCategoryOrderModal, setShowCategoryOrderModal] =
    createSignal(false);

  // Product form state
  const [editingIndex, setEditingIndex] = createSignal<number | null>(null);
  const [editingTab, setEditingTab] = createSignal<TabKey>("basePlans");
  const [editingItem, setEditingItem] = createSignal<ProductItem | null>(null);

  const [resultDialog, setResultDialog] = createSignal<{
    title: string;
    message: string;
    variant: "admin" | "danger";
  } | null>(null);
  const actionsDisabled = () => loading() || saving() || !catalog();

  const loadCatalog = async () => {
    setLoading(true);
    setAccessError("");
    try {
      const data = await productsService.getProducts(true);
      setCatalog(data);
    } catch (err) {
      console.error("Failed to load products", err);
      setAccessError(
        getCaptchaAwareErrorMessage(err, "Unable to load products data."),
      );
    } finally {
      setLoading(false);
    }
  };

  onMount(async () => {
    try {
      const { accessLevel, isAdmin } =
        await teamService.getCurrentUserAccessLevel();
      const access = accessLevel.toLowerCase();
      if (!isAdmin && access !== "editor") {
        setAccessError("You do not have access to manage products.");
        setLoading(false);
        return;
      }
      await loadCatalog();
    } catch (err) {
      setAccessError(
        getCaptchaAwareErrorMessage(
          err,
          "Unable to verify your access right now.",
        ),
      );
      setLoading(false);
    }
  });

  const basePlans = createMemo<BasePlan[]>(() => catalog()?.basePlans || []);
  const riders = createMemo<Rider[]>(() => catalog()?.riders || []);

  const openAddProduct = (tab: TabKey) => {
    setEditingIndex(null);
    setEditingTab(tab);
    setEditingItem(null);
    setShowAddModal(true);
  };

  const openEditProduct = (tab: TabKey, item: ProductItem, index: number) => {
    setEditingIndex(index);
    setEditingTab(tab);
    setEditingItem(item);
    setShowEditModal(false);
    setShowAddModal(true);
  };

  const handleDeleteProduct = async (
    tab: TabKey,
    index: number,
    item: ProductItem,
  ) => {
    const currentCatalog = catalog();
    if (!currentCatalog) return;
    const name = item.shortName || item.fullName || item.id;
    const snapshotTitle = formatProductChangeSnapshotTitle("Delete", item);

    const list = tab === "riders" ? [...riders()] : [...basePlans()];
    list.splice(index, 1);
    const updated: ProductCatalog = {
      ...currentCatalog,
      basePlans: tab === "riders" ? basePlans() : (list as BasePlan[]),
      riders: tab === "riders" ? (list as Rider[]) : riders(),
    };

    setSaving(true);
    try {
      await productsService.setProducts(updated, snapshotTitle);
      setCatalog(updated);
      setShowAddModal(false);
      setResultDialog({
        title: "Success",
        message: `Deleted ${name}.`,
        variant: "admin",
      });
    } catch (err) {
      console.error("Failed to delete product", err);
      setResultDialog({
        title: "Error",
        message: getCaptchaAwareErrorMessage(err, "Unable to delete product."),
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate(-1)}
        icon={<Dynamic component={adminOption().icon} class="h-5 w-5" />}
        title={adminOption().title}
        subtitle={adminOption().description}
      />

      <PageBody><div class="space-y-4">
        <Show
          when={!accessError()}
          fallback={
            <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700">
              {accessError()}
            </div>
          }
        >
          <div class="w-full max-w-2xl space-y-3">
            {manageProductsActionOptions.map((option) => (
              <button
                type="button"
                disabled={actionsDisabled()}
                onClick={() => {
                  if (actionsDisabled()) return;
                  if (option.action === "editGstTypes") {
                    setShowGSTTypesModal(true);
                    return;
                  }
                  if (option.action === "addRider") {
                    openAddProduct("riders");
                    return;
                  }
                  if (option.action === "addBasePlan") {
                    openAddProduct("basePlans");
                    return;
                  }
                  if (option.action === "editPlan") {
                    setShowEditModal(true);
                    return;
                  }
                  setShowCategoryOrderModal(true);
                }}
                class={`${adminActionButtonClass} ${option.class || ""} ${
                  actionsDisabled() ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                <div class="flex items-start gap-3">
                  <option.icon class="mt-0.5 h-5 w-5 text-admin-from" />
                  <div>
                    <div class="text-base font-semibold text-gray-900">
                      {option.title}
                    </div>
                    <div class="text-base text-gray-500">
                      {option.description}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <Show when={loading()}>
            <div class="py-2">
              <LoadingState label="Loading products catalog..." />
            </div>
          </Show>
        </Show>
      </div></PageBody>

      {/* GSTTypes Modal */}
      <Show when={showGSTTypesModal() && catalog()}>
        <ProductGSTTypesModal
          catalog={catalog()!}
          onClose={() => setShowGSTTypesModal(false)}
          onSaved={(updated) => {
            setCatalog(updated);
            setShowGSTTypesModal(false);
            setResultDialog({
              title: "Success",
              message: "GST and type definitions updated successfully.",
              variant: "admin",
            });
          }}
          onError={(message) => {
            setResultDialog({
              title: "Error",
              message,
              variant: "danger",
            });
          }}
        />
      </Show>

      {/* Edit Modal */}
      <Show when={showEditModal() && catalog()}>
        <ProductPickerModal
          catalog={catalog()!}
          onClose={() => setShowEditModal(false)}
          onEditProduct={openEditProduct}
          onDeleteProduct={(tab, item, index) => {
            void handleDeleteProduct(tab, index, item);
          }}
        />
      </Show>

      {/* Product Add Modal */}
      <Show when={showAddModal() && catalog()}>
        <ProductEditorModal
          catalog={catalog()!}
          editingTab={editingTab()}
          editingIndex={editingIndex()}
          editingItem={editingItem()}
          onClose={() => setShowAddModal(false)}
          onSaved={(updated, label) => {
            setCatalog(updated);
            if (
              editingIndex() !== null ||
              (editingIndex() === null && editingTab() === "basePlans")
            ) {
              setShowAddModal(false);
            }
            setResultDialog({
              title: "Success",
              message: `Saved ${label}.`,
              variant: "admin",
            });
          }}
          onError={(message) => {
            setResultDialog({
              title: "Error",
              message,
              variant: "danger",
            });
          }}
        />
      </Show>

      {/* Category Order Modal */}
      <Show when={showCategoryOrderModal()}>
        <ProductReorderModal
          onClose={() => setShowCategoryOrderModal(false)}
          onSaved={() => {
            setShowCategoryOrderModal(false);
            setResultDialog({
              title: "Success",
              message: "List order updated successfully.",
              variant: "admin",
            });
          }}
          onError={(message) => {
            setResultDialog({
              title: "Error",
              message,
              variant: "danger",
            });
          }}
        />
      </Show>

      <ConfirmModal
        open={!!resultDialog()}
        title={resultDialog()?.title || ""}
        message={resultDialog()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={resultDialog()?.variant || "default"}
        onConfirm={() => setResultDialog(null)}
        onCancel={() => setResultDialog(null)}
      />

    </PageShell>
  );
};

export default ManageProducts;
