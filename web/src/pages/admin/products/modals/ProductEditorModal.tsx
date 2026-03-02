import {
  Component,
  Show,
  For,
  Index,
  createSignal,
  createMemo,
} from "solid-js";
import {
  TbOutlinePlus,
  TbOutlineTrash,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
  TbOutlineCheck,
} from "solid-icons/tb";
import { Button, EditModal, IconButton } from "../../../../components/ui";
import {
  productsService,
  type BasePlan,
  type Rider,
  type ProductCatalog,
} from "../../../../services/productsService";
import ProductCatalogBrowser from "../../../../components/ProductCatalogBrowser";
import {
  formatProductAddSnapshotTitle,
  formatProductChangeSnapshotTitle,
} from "../snapshotTitles";
import {
  type TabKey,
  type ProductItem,
  type OptionRow,
  defaultFrequencies,
  getOptionEntries,
  createOptionRow,
} from "./types";
import { riderCategoryBadgeClass } from "../../../../utils/productBadges";

type Props = {
  catalog: ProductCatalog;
  editingTab: TabKey;
  editingIndex: number | null;
  editingItem: ProductItem | null;
  onClose: () => void;
  onSaved: (updated: ProductCatalog, label: string) => void;
  onError: (message: string) => void;
};

const ProductEditorModal: Component<Props> = (props) => {
  const basePlans = () => props.catalog.basePlans || [];
  const riders = () => props.catalog.riders || [];
  const typeMap = () => props.catalog.types || {};

  const typeEntries = createMemo(() =>
    Object.entries(typeMap()).sort((a, b) => a[0].localeCompare(b[0])),
  );

  const categoryOptions = createMemo(() => {
    const items = props.editingTab === "riders" ? riders() : basePlans();
    const categories = Array.from(
      new Set(items.map((item) => item.category || "").filter(Boolean)),
    );
    return categories.sort((a, b) => a.localeCompare(b));
  });

  const getDefaultFrequenciesForType = (type: string): string[] => {
    const normalized = type.trim().toLowerCase();
    if (!normalized) return [];
    return normalized === "single"
      ? ["Single"]
      : defaultFrequencies.filter((freq) => freq !== "Single");
  };

  const getInitialFrequencies = (item: ProductItem | null): string[] => {
    const saved = item?.frequencies || [];
    if (saved.length > 0) return [...saved];
    return getDefaultFrequenciesForType(item?.type || "");
  };

  const normalizeFrequencySelection = (values: string[]): string[] =>
    defaultFrequencies.filter((freq) => values.includes(freq));

  const isDefaultFrequencySelection = (
    selected: string[],
    type: string,
  ): boolean => {
    const normalizedSelected = normalizeFrequencySelection(selected);
    const defaults = getDefaultFrequenciesForType(type);
    return (
      normalizedSelected.length === defaults.length &&
      normalizedSelected.every((value, index) => value === defaults[index])
    );
  };

  // Form state
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});
  const [formId, setFormId] = createSignal(props.editingItem?.id || "");
  const [formCategory, setFormCategory] = createSignal(
    props.editingItem?.category || "",
  );
  const [formCategoryCustom, setFormCategoryCustom] = createSignal("");
  const [formCategoryIsCustom, setFormCategoryIsCustom] = createSignal(
    (() => {
      const category = props.editingItem?.category || "";
      return category !== "" && !categoryOptions().includes(category);
    })(),
  );
  const [formFullName, setFormFullName] = createSignal(
    props.editingItem?.fullName || "",
  );
  const [formShortName, setFormShortName] = createSignal(
    props.editingItem?.shortName || "",
  );
  const [formType, setFormType] = createSignal(props.editingItem?.type || "");
  const [formNotes, setFormNotes] = createSignal(
    props.editingItem?.notes || "",
  );
  const [formOptionTitle, setFormOptionTitle] = createSignal(
    props.editingItem?.optionTitle || "",
  );
  const [formOptions, setFormOptions] = createSignal<OptionRow[]>(
    props.editingItem
      ? getOptionEntries(props.editingItem).map(([label, fycRate]) =>
          createOptionRow(label, fycRate),
        )
      : [],
  );
  const [formHasOptions, setFormHasOptions] = createSignal(
    props.editingItem ? getOptionEntries(props.editingItem).length > 0 : false,
  );
  const [formFycRate, setFormFycRate] = createSignal(
    props.editingItem?.fycRate || "",
  );
  const [formFollowsBasePlan, setFormFollowsBasePlan] = createSignal(
    props.editingTab === "riders" && props.editingItem?.fycRate === "-1",
  );
  const [formFrequencies, setFormFrequencies] = createSignal<string[]>(
    getInitialFrequencies(props.editingItem),
  );
  const [formGst, setFormGst] = createSignal(props.editingItem?.gst === "Y");
  const [formCountsTowardProduction, setFormCountsTowardProduction] =
    createSignal(props.editingItem?.countsTowardProduction !== "N");
  const [formAttachableRiders, setFormAttachableRiders] = createSignal<
    string[]
  >(
    props.editingTab === "basePlans" && props.editingItem
      ? [...((props.editingItem as BasePlan).attachableRiders || [])]
      : [],
  );
  const [showAttachablePicker, setShowAttachablePicker] = createSignal(false);
  const [optionRowAnimating, setOptionRowAnimating] = createSignal<
    Record<string, "up" | "down">
  >({});
  const fycErrorMessage = () => "FYC rate must be numeric and at least 0.";
  const selectedAttachableRiders = createMemo<Rider[]>(() => {
    const riderById = new Map(riders().map((rider) => [rider.id, rider] as const));
    return formAttachableRiders()
      .map((id) => riderById.get(id))
      .filter((item): item is Rider => Boolean(item));
  });

  const setFieldError = (key: string, value?: string) =>
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  const getFieldError = (key: string) => fieldErrors()[key];
  const clearOptionFieldErrors = () =>
    setFieldErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => !key.startsWith("option")),
      ),
    );
  const clearFycFieldError = () => setFieldError("fycRate");

  const parseFyc = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const validateFyc = (value: string) => {
    if (!value.trim()) return fycErrorMessage();
    const parsed = parseFyc(value);
    return Number.isFinite(parsed) && parsed >= 0
      ? undefined
      : fycErrorMessage();
  };

  const validateCategory = () =>
    setFieldError("category", formCategory().trim() ? undefined : "Category is required.");
  const validateFullName = () =>
    setFieldError("fullName", formFullName().trim() ? undefined : "Full name is required.");
  const validateShortName = () =>
    setFieldError("shortName", formShortName().trim() ? undefined : "Short name is required.");
  const validateType = () =>
    setFieldError("type", formType().trim() ? undefined : "Type is required.");
  const validateFycRate = () => {
    if (formHasOptions()) return;
    if (props.editingTab === "riders" && formFollowsBasePlan()) {
      clearFycFieldError();
      return;
    }
    setFieldError("fycRate", validateFyc(formFycRate()));
  };
  const validateOptionTitle = () => {
    if (!formHasOptions()) return;
    setFieldError(
      "optionTitle",
      formOptionTitle().trim() ? undefined : "Option title is required.",
    );
  };
  const validateOptionRowLabel = (id: string, value: string) => {
    if (!formHasOptions()) return;
    setFieldError(
      `optionLabel:${id}`,
      value.trim() ? undefined : "Option label is required.",
    );
  };
  const validateOptionRowFyc = (id: string, value: string) => {
    if (!formHasOptions()) return;
    if (!value.trim()) {
      setFieldError(`optionFyc:${id}`, fycErrorMessage());
      return;
    }
    const parsed = parseFyc(value);
    setFieldError(
      `optionFyc:${id}`,
      Number.isFinite(parsed) && parsed >= 0 ? undefined : fycErrorMessage(),
    );
  };

  const getInitialSnapshot = () =>
    JSON.stringify({
      id: props.editingItem?.id || "",
      category: props.editingItem?.category || "",
      fullName: props.editingItem?.fullName || "",
      shortName: props.editingItem?.shortName || "",
      type: props.editingItem?.type || "",
      notes: props.editingItem?.notes || "",
      optionTitle: props.editingItem?.optionTitle || "",
      options: props.editingItem
        ? getOptionEntries(props.editingItem).map(([label, fycRate]) => ({
            label,
            fycRate,
          }))
        : [],
      hasOptions: props.editingItem
        ? getOptionEntries(props.editingItem).length > 0
        : false,
      fycRate: props.editingItem?.fycRate || "",
      frequencies: getInitialFrequencies(props.editingItem),
      gst: props.editingItem?.gst === "Y",
      countsTowardProduction: props.editingItem?.countsTowardProduction !== "N",
      attachableRiders:
        props.editingTab === "basePlans" && props.editingItem
          ? (props.editingItem as BasePlan).attachableRiders || []
          : [],
    });
  const [initialSnapshot, setInitialSnapshot] =
    createSignal(getInitialSnapshot());

  const currentSnapshot = () =>
    JSON.stringify({
      id: formId(),
      category: formCategory(),
      fullName: formFullName(),
      shortName: formShortName(),
      type: formType(),
      notes: formNotes(),
      optionTitle: formOptionTitle(),
      options: formOptions().map(({ label, fycRate }) => ({ label, fycRate })),
      hasOptions: formHasOptions(),
      fycRate: formFycRate(),
      frequencies: formFrequencies(),
      gst: formGst(),
      countsTowardProduction: formCountsTowardProduction(),
      attachableRiders: formAttachableRiders(),
    });

  const hasUnsavedChanges = () => currentSnapshot() !== initialSnapshot();

  const getNextId = (tab: TabKey) => {
    const items = tab === "basePlans" ? basePlans() : riders();
    let maxId = 0;
    items.forEach((item) => {
      const numeric = Number(String(item.id || "").replace(/\D/g, ""));
      if (Number.isFinite(numeric)) {
        maxId = Math.max(maxId, numeric);
      }
    });
    const prefix = tab === "basePlans" ? "B" : "R";
    return `${prefix}${maxId + 1}`;
  };

  const isValid = createMemo(() => {
    if (!formId().trim() && props.editingIndex !== null) return false;
    if (!formCategory().trim()) return false;
    if (!formFullName().trim()) return false;
    if (!formShortName().trim()) return false;
    if (!formType().trim()) return false;

    const isValidSingleFyc = (value: string) => {
      if (!value.trim()) return false;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    };
    const isValidOptionFyc = (value: string) => {
      if (!value.trim()) return false;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    };

    if (formHasOptions()) {
      const optionRows = formOptions();
      if (!formOptionTitle().trim()) return false;
      if (optionRows.length === 0) return false;
      if (optionRows.some((row) => !row.label.trim() || !row.fycRate.trim()))
        return false;
      if (optionRows.some((row) => !isValidOptionFyc(row.fycRate))) return false;
    } else {
      if (props.editingTab === "riders" && formFollowsBasePlan()) return true;
      if (!isValidSingleFyc(formFycRate())) return false;
    }

    return true;
  });

  const addOptionRow = () => {
    setFormOptions((prev) => [...prev, createOptionRow()]);
  };

  const enableOptionsMode = () => {
    setFormHasOptions(true);
    setFormOptions((prev) => (prev.length ? prev : [createOptionRow()]));
  };

  const removeOptionRow = (id: string) => {
    setFormOptions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== id);
    });
  };

  const updateOptionRow = (id: string, next: Partial<OptionRow>) => {
    setFormOptions((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...next } : row)),
    );
  };

  const moveOptionRow = (from: number, to: number) => {
    setFormOptions((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const movedId = prev[from]?.id;
      const displacedId = prev[to]?.id;
      const direction = to < from ? "up" : "down";
      const opposite = direction === "up" ? "down" : "up";
      if (movedId && displacedId) {
        setOptionRowAnimating({
          [movedId]: direction,
          [displacedId]: opposite,
        });
        window.setTimeout(() => setOptionRowAnimating({}), 320);
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const toggleFrequency = (freq: string) => {
    setFormFrequencies((prev) => {
      if (prev.includes(freq)) {
        return prev.filter((item) => item !== freq);
      }
      return [...prev, freq];
    });
  };
  const getFrequencyLabel = (freq: string) => {
    if (freq === "Mthly-1") return "Monthly (1 month premium collected)";
    if (freq === "Mthly-2") return "Monthly (2 months premium collected)";
    return freq;
  };
  const toggleAttachableRider = (id: string) => {
    setFormAttachableRiders((prev) =>
      prev.includes(id)
        ? prev.filter((value) => value !== id)
        : [...prev, id],
    );
  };

  const handleSave = async () => {
    if (!isValid()) return;

    const optionRows = formHasOptions() ? formOptions() : [];
    if (formHasOptions()) {
      const invalidOption = optionRows.find(
        (row) => !Number.isFinite(parseFyc(row.fycRate)) || parseFyc(row.fycRate) < 0,
      );
      if (invalidOption) {
        setError(fycErrorMessage());
        return;
      }
    } else if (
      !(props.editingTab === "riders" && formFollowsBasePlan()) && (
      !Number.isFinite(parseFyc(formFycRate())) ||
      parseFyc(formFycRate()) < 0
      )
    ) {
      setError(fycErrorMessage());
      return;
    }

    const options = optionRows
      .map((row) => ({
        label: row.label.trim(),
        fycRate: row.fycRate.trim(),
      }))
      .filter((row) => row.label);

    const normalizedFrequencies =
      normalizeFrequencySelection(formFrequencies());
    const frequencies =
      normalizedFrequencies.length === 0 ||
      isDefaultFrequencySelection(normalizedFrequencies, formType())
        ? undefined
        : normalizedFrequencies;
    const attachableIds =
      props.editingTab === "basePlans" && formAttachableRiders().length > 0
        ? formAttachableRiders()
        : undefined;

    const nextItem: ProductItem = {
      id:
        props.editingIndex === null
          ? getNextId(props.editingTab)
          : formId().trim(),
      category: formCategory().trim(),
      fullName: formFullName().trim(),
      shortName: formShortName().trim(),
      type: formType().trim(),
      notes: formNotes().trim() || undefined,
      optionTitle: formHasOptions()
        ? formOptionTitle().trim() || undefined
        : undefined,
      options: formHasOptions() && options.length ? options : undefined,
      fycRate: formFycRate().trim() || undefined,
      frequencies,
      gst: formGst() ? "Y" : undefined,
      countsTowardProduction: formCountsTowardProduction() ? undefined : "N",
      attachableRiders: attachableIds,
    };

    const list =
      props.editingTab === "riders" ? [...riders()] : [...basePlans()];
    const index = props.editingIndex;
    if (index !== null && index >= 0 && index < list.length) {
      list[index] = nextItem as any;
    } else {
      list.push(nextItem as any);
    }

    const updated: ProductCatalog = {
      ...props.catalog,
      basePlans:
        props.editingTab === "riders" ? basePlans() : (list as BasePlan[]),
      riders: props.editingTab === "riders" ? (list as Rider[]) : riders(),
    };

    setSaving(true);
    setError("");
    try {
      await productsService.setProducts(
        updated,
        props.editingIndex === null
          ? props.editingTab === "riders"
            ? formatProductAddSnapshotTitle("Add Rider / Top-up", nextItem)
            : formatProductAddSnapshotTitle("Add Base Plan", nextItem)
          : formatProductChangeSnapshotTitle("Edit", nextItem)
      );
      const label = nextItem.shortName || nextItem.fullName || nextItem.id;
      setInitialSnapshot(currentSnapshot());
      props.onSaved(updated, label || "Product");
    } catch (err) {
      console.error("Failed to save product", err);
      props.onError("Unable to save product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal
      title={`${props.editingIndex === null ? "Add" : "Edit"} ${
        props.editingTab === "riders" ? "Rider/Top-up" : "Base Plan"
      }`}
      onClose={props.onClose}
      onSave={handleSave}
      saving={() => saving()}
      saveDisabled={saving() || !isValid() || !hasUnsavedChanges()}
      hasUnsavedChanges={hasUnsavedChanges}
    >
      <div class="space-y-4">
        <Show when={props.editingTab === "basePlans"}>
          <div>
            <label class="mb-1 block text-base font-medium text-gray-700">
              Attachable Riders / Top-up Items
            </label>
            <p class="mb-2 text-sm text-gray-500">
              Add riders/top-up items separately first if they do not yet exist.
            </p>
            <div class="space-y-2 rounded-lg border border-gray-200 bg-white p-2">
              <Show
                when={selectedAttachableRiders().length}
                fallback={
                  <div class="text-sm text-gray-500">
                    No rider/top-up item selected yet.
                  </div>
                }
              >
                <div class="flex flex-wrap gap-2">
                  <For each={selectedAttachableRiders()}>
                    {(rider) => (
                      <span
                        class={`rounded px-2 py-1 text-sm ${riderCategoryBadgeClass(
                          rider.category || "",
                        )}`}
                      >
                        {rider.shortName || rider.id}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="flex justify-center pt-3">
              <Button
                type="button"
                variant="adminOutline"
                size="sm"
                onClick={() => setShowAttachablePicker(true)}
              >
                <TbOutlinePlus class="h-3.5 w-3.5" />
                Choose rider/top-up items
              </Button>
            </div>
          </div>
        </Show>

        <div class="flex flex-col gap-4">
          <div class="space-y-3">
            <div class="flex flex-col gap-3">
              <Show when={props.editingIndex !== null}>
                <div>
                  <label class="mb-1 block text-base font-medium text-gray-700">
                    ID
                  </label>
                  <input
                    type="text"
                    value={formId()}
                    disabled
                    class="w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-base text-gray-500"
                  />
                  <p class="mt-1 text-sm text-gray-400">
                    ID is auto-generated and cannot be edited.
                  </p>
                </div>
              </Show>
              <div class="relative">
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Category
                </label>
                <select
                  value={formCategoryIsCustom() ? "__custom__" : formCategory()}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    if (next === "__custom__") {
                      setFormCategoryIsCustom(true);
                      const fallback = formCategoryCustom() || formCategory();
                      setFormCategoryCustom(fallback);
                      setFormCategory(fallback);
                      return;
                    }
                    setFormCategoryIsCustom(false);
                    setFormCategoryCustom("");
                    setFormCategory(next);
                    setFieldError("category");
                  }}
                  onBlur={validateCategory}
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                >
                  <option value="">Select category</option>
                  <For each={categoryOptions()}>
                    {(label) => <option value={label}>{label}</option>}
                  </For>
                  <option value="__custom__">+ Add new category</option>
                </select>
                <Show when={formCategoryIsCustom()}>
                  <input
                    type="text"
                    value={formCategoryCustom()}
                    onInput={(e) => {
                      const next = e.currentTarget.value;
                      setFormCategoryCustom(next);
                      setFormCategory(next);
                      setFieldError("category");
                    }}
                    onBlur={validateCategory}
                    placeholder="Enter new category"
                    class="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                  />
                </Show>
                <Show when={getFieldError("category")}>
                  <p class="mt-1 text-sm text-red-600">{getFieldError("category")}</p>
                </Show>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div>
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formFullName()}
                  onInput={(e) => {
                    setFormFullName(e.currentTarget.value);
                    setFieldError("fullName");
                  }}
                  onBlur={validateFullName}
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                />
                <Show when={getFieldError("fullName")}>
                  <p class="mt-1 text-sm text-red-600">{getFieldError("fullName")}</p>
                </Show>
              </div>
              <div>
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Short Name
                </label>
                <input
                  type="text"
                  value={formShortName()}
                  onInput={(e) => {
                    setFormShortName(e.currentTarget.value);
                    setFieldError("shortName");
                  }}
                  onBlur={validateShortName}
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                />
                <Show when={getFieldError("shortName")}>
                  <p class="mt-1 text-sm text-red-600">{getFieldError("shortName")}</p>
                </Show>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div class="relative">
                <label class="mb-1 block text-base font-medium text-gray-700">
                  Type
                </label>
                <select
                  value={formType()}
                  onChange={(e) => {
                    const nextType = e.currentTarget.value;
                    setFormType(nextType);
                    setFormFrequencies(getDefaultFrequenciesForType(nextType));
                    setFieldError("type");
                  }}
                  onBlur={validateType}
                  class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                >
                  <option value="">Select type</option>
                  <For each={typeEntries()}>
                    {(entry) => <option value={entry[0]}>{entry[1]}</option>}
                  </For>
                  <Show
                    when={
                      formType() &&
                      !typeEntries().some(([key]) => key === formType())
                    }
                  >
                    <option value={formType()}>{formType()}</option>
                  </Show>
                </select>
                <Show when={getFieldError("type")}>
                  <p class="mt-1 text-sm text-red-600">{getFieldError("type")}</p>
                </Show>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-base font-medium text-gray-700">
                Notes
              </label>
              <textarea
                rows={3}
                value={formNotes()}
                onInput={(e) => setFormNotes(e.currentTarget.value)}
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
              />
            </div>

            <div class="border-t border-gray-200 pt-3">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <label class="text-base font-medium text-gray-700">
                  Does GST apply?
                </label>
                <div class="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="adminOutline"
                    size="sm"
                    onClick={() => setFormGst(true)}
                    class={formGst() ? "border-admin-from bg-admin-from text-white" : ""}
                    aria-pressed={formGst()}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="adminOutline"
                    size="sm"
                    onClick={() => setFormGst(false)}
                    class={formGst() ? "" : "border-admin-from bg-admin-from text-white"}
                    aria-pressed={!formGst()}
                  >
                    No
                  </Button>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-200 pt-3">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <label class="text-base font-medium text-gray-700">
                  Count towards AIA production?
                </label>
                <div class="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="adminOutline"
                    size="sm"
                    onClick={() => setFormCountsTowardProduction(true)}
                    class={
                      formCountsTowardProduction()
                        ? "border-admin-from bg-admin-from text-white"
                        : ""
                    }
                    aria-pressed={formCountsTowardProduction()}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="adminOutline"
                    size="sm"
                    onClick={() => setFormCountsTowardProduction(false)}
                    class={
                      formCountsTowardProduction()
                        ? ""
                        : "border-admin-from bg-admin-from text-white"
                    }
                    aria-pressed={!formCountsTowardProduction()}
                  >
                    No
                  </Button>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div>
                <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <label class="text-base font-medium text-gray-700">
                    Does FYC rate vary by Entry Age/other option?
                  </label>
                  <Show
                    when={props.editingTab === "riders"}
                    fallback={
                      <div class="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="adminOutline"
                          size="sm"
                          onClick={() => enableOptionsMode()}
                          class={`${
                            formHasOptions()
                              ? "border-admin-from bg-admin-from text-white"
                              : ""
                          }`}
                          aria-pressed={formHasOptions()}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant="adminOutline"
                          size="sm"
                          onClick={() => {
                            setFormHasOptions(false);
                            clearOptionFieldErrors();
                          }}
                          class={`${
                            formHasOptions()
                              ? ""
                              : "border-admin-from bg-admin-from text-white"
                          }`}
                          aria-pressed={!formHasOptions()}
                        >
                          No
                        </Button>
                      </div>
                    }
                  >
                    <div class="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="adminOutline"
                        size="sm"
                        onClick={() => {
                          enableOptionsMode();
                          setFormFollowsBasePlan(false);
                          if (formFycRate() === "-1") setFormFycRate("");
                        }}
                        class={`${
                          formHasOptions()
                            ? "border-admin-from bg-admin-from text-white"
                            : ""
                        }`}
                        aria-pressed={formHasOptions()}
                      >
                        Yes
                      </Button>
                      <Button
                        type="button"
                        variant="adminOutline"
                        size="sm"
                        onClick={() => {
                          setFormHasOptions(false);
                          setFormFollowsBasePlan(false);
                          if (formFycRate() === "-1") setFormFycRate("");
                          clearOptionFieldErrors();
                        }}
                        class={`${
                          !formHasOptions() && !formFollowsBasePlan()
                            ? "border-admin-from bg-admin-from text-white"
                            : ""
                        }`}
                        aria-pressed={!formHasOptions() && !formFollowsBasePlan()}
                      >
                        No
                      </Button>
                      <Button
                        type="button"
                        variant="adminOutline"
                        size="sm"
                        onClick={() => {
                          setFormHasOptions(false);
                          setFormFollowsBasePlan(true);
                          setFormFycRate("-1");
                          clearOptionFieldErrors();
                          clearFycFieldError();
                        }}
                        class={`${
                          !formHasOptions() && formFollowsBasePlan()
                            ? "border-admin-from bg-admin-from text-white"
                            : ""
                        }`}
                        aria-pressed={!formHasOptions() && formFollowsBasePlan()}
                      >
                        Follows base plan
                      </Button>
                    </div>
                  </Show>
                </div>

                <Show when={!formHasOptions()}>
                  <div class="mt-3">
                    <Show
                      when={props.editingTab === "riders"}
                      fallback={
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <label class="self-center text-base font-medium text-gray-700">
                            FYC Rate (%)
                          </label>
                          <div class="w-20">
                            <input
                              type="text"
                              value={formFycRate()}
                              onInput={(e) => {
                                setFormFycRate(e.currentTarget.value);
                                clearFycFieldError();
                              }}
                              onBlur={validateFycRate}
                              placeholder="e.g. 25"
                              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                            />
                            <Show when={getFieldError("fycRate")}>
                              <p class="mt-1 text-sm text-red-600">{getFieldError("fycRate")}</p>
                            </Show>
                          </div>
                        </div>
                      }
                    >
                      <Show when={!formFollowsBasePlan()}>
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <label class="self-center text-base font-medium text-gray-700">
                            FYC rate (%)
                          </label>
                          <div class="w-20">
                            <input
                              type="text"
                              value={formFycRate()}
                              onInput={(e) => {
                                setFormFycRate(e.currentTarget.value);
                                clearFycFieldError();
                              }}
                              onBlur={validateFycRate}
                              placeholder="e.g. 25"
                              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                            />
                            <Show when={getFieldError("fycRate")}>
                              <p class="mt-1 text-sm text-red-600">{getFieldError("fycRate")}</p>
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>

              <Show when={formHasOptions()}>
                <div class="space-y-3">
                  <div>
                    <label class="mb-1 block text-base font-medium text-gray-700">
                      Option Title
                    </label>
                    <input
                      type="text"
                      value={formOptionTitle()}
                      onInput={(e) => {
                        setFormOptionTitle(e.currentTarget.value);
                        setFieldError("optionTitle");
                      }}
                      onBlur={validateOptionTitle}
                      placeholder="e.g. Entry Age"
                      class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                    />
                    <Show when={getFieldError("optionTitle")}>
                      <p class="mt-1 text-sm text-red-600">{getFieldError("optionTitle")}</p>
                    </Show>
                  </div>

                  <div>
                    <div class="mb-2 flex items-center gap-1">
                      <div class="min-w-0 flex-1 text-center text-sm font-medium text-gray-600">
                        {formOptionTitle().trim() || "Option title"}
                      </div>
                      <div class="min-w-0 flex-1 text-center text-sm font-medium text-gray-600">
                        FYC Rate (%)
                      </div>
                      <div class="w-20" aria-hidden="true" />
                    </div>
                    <div>
                      <Show
                        when={formOptions().length}
                        fallback={
                          <p class="text-sm text-gray-500">No option rows.</p>
                        }
                      >
                        <Index each={formOptions()}>
                          {(row, index) => (
                            <div
                              class={`flex flex-col gap-2 ${
                                index % 2 === 0 ? "bg-admin-from/5" : "bg-admin-from/10"
                              } ${
                                optionRowAnimating()[row().id] === "up"
                                  ? "reorder-move-up"
                                  : optionRowAnimating()[row().id] === "down"
                                    ? "reorder-move-down"
                                    : ""
                              } px-2 py-2`}
                            >
                              <div class="flex flex-wrap items-center gap-1">
                                <div class="min-w-0 flex-1">
                                  <input
                                    type="text"
                                    placeholder="e.g. 0-60"
                                    value={row().label}
                                    onInput={(e) => {
                                      updateOptionRow(row().id, {
                                        label: e.currentTarget.value,
                                      });
                                      setFieldError(`optionLabel:${row().id}`);
                                    }}
                                    onBlur={() =>
                                      validateOptionRowLabel(row().id, row().label)
                                    }
                                    class="min-w-0 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                                  />
                                  <Show when={getFieldError(`optionLabel:${row().id}`)}>
                                    <p class="mt-1 text-sm text-red-600">
                                      {getFieldError(`optionLabel:${row().id}`)}
                                    </p>
                                  </Show>
                                </div>
                                <div class="min-w-0 flex-1">
                                  <input
                                    type="text"
                                    placeholder="FYC Rate (%)"
                                    value={row().fycRate}
                                    onInput={(e) => {
                                      updateOptionRow(row().id, {
                                        fycRate: e.currentTarget.value,
                                      });
                                      setFieldError(`optionFyc:${row().id}`);
                                    }}
                                    onBlur={() =>
                                      validateOptionRowFyc(row().id, row().fycRate)
                                    }
                                    class="min-w-0 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-admin-from focus:outline-none focus:ring-1 focus:ring-admin-from/40"
                                  />
                                  <Show when={getFieldError(`optionFyc:${row().id}`)}>
                                    <p class="mt-1 text-sm text-red-600">
                                      {getFieldError(`optionFyc:${row().id}`)}
                                    </p>
                                  </Show>
                                </div>
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    moveOptionRow(index, index - 1)
                                  }
                                  disabled={index === 0}
                                  class="h-6 w-6 rounded-lg text-gray-600"
                                  aria-label="Move option up"
                                >
                                  <TbOutlineArrowUp class="h-4 w-4" />
                                </IconButton>
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    moveOptionRow(index, index + 1)
                                  }
                                  disabled={index === formOptions().length - 1}
                                  class="h-6 w-6 rounded-lg text-gray-600"
                                  aria-label="Move option down"
                                >
                                  <TbOutlineArrowDown class="h-4 w-4" />
                                </IconButton>
                                <IconButton
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  onClick={() => removeOptionRow(row().id)}
                                  disabled={formOptions().length <= 1}
                                  class="h-6 w-6 rounded-lg text-red-600 hover:bg-red-50"
                                  aria-label="Remove option"
                                >
                                  <TbOutlineTrash class="h-4 w-4" />
                                </IconButton>
                              </div>
                            </div>
                          )}
                        </Index>
                      </Show>
                    </div>
                    <div class="flex justify-center pt-2">
                      <Button
                        type="button"
                        variant="adminOutline"
                        size="sm"
                        onClick={addOptionRow}
                      >
                        <TbOutlinePlus class="h-3.5 w-3.5" />
                        Add option
                      </Button>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>

      </div>

      <Show when={showAttachablePicker()}>
        <EditModal
          title="Choose rider/top-up item"
          onClose={() => setShowAttachablePicker(false)}
          bodyClass="pb-6"
        >
          <Show
            when={riders().length}
            fallback={
              <div class="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">
                No riders/top-up items available yet.
              </div>
            }
          >
            <ProductCatalogBrowser
              basePlans={[]}
              riders={riders()}
              accentColor="admin"
              initialTab="riders"
              showTabs={false}
              renderItem={(item, _localIndex, _tab, highlight) => {
                const rider = item as Rider;
                const isSelected = () => formAttachableRiders().includes(rider.id);
                return (
                  <button
                    type="button"
                    onClick={() => toggleAttachableRider(rider.id)}
                    class="flex w-full items-center gap-2 border-b border-gray-300 p-3 text-left transition-colors hover:bg-admin-from/5"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-base font-medium text-gray-900">
                          {highlight(rider.fullName || "Unnamed rider/top-up")}
                        </span>
                        <Show when={rider.shortName}>
                          <span class="rounded bg-admin-from/10 px-1.5 py-0.5 text-sm text-admin-from">
                            {highlight(rider.shortName || "")}
                          </span>
                        </Show>
                      </div>
                    </div>
                    <span
                      class={`flex h-5 w-5 items-center justify-center rounded border ${
                        isSelected()
                          ? "border-admin-from bg-admin-from/10 text-admin-from"
                          : "border-gray-300 bg-white text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      <TbOutlineCheck class="h-4 w-4" />
                    </span>
                  </button>
                );
              }}
            />
          </Show>
        </EditModal>
      </Show>

      <div class="mt-6 space-y-3 border-t border-gray-200 pt-4">
        <div>
          <div class="mb-2">
            <label class="text-base font-medium text-gray-700">
              Frequency Options
            </label>
          </div>
          <div class="space-y-2">
            <For each={defaultFrequencies}>
              {(freq) => (
                <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={formFrequencies().includes(freq)}
                    onChange={() => toggleFrequency(freq)}
                    class="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-admin-from focus:ring-admin-from/40"
                    style="accent-color: var(--color-admin-from);"
                  />
                  {getFrequencyLabel(freq)}
                </label>
              )}
            </For>
          </div>
        </div>

        <Show when={error()}>
          <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">
            {error()}
          </div>
        </Show>
      </div>
    </EditModal>
  );
};

export default ProductEditorModal;
