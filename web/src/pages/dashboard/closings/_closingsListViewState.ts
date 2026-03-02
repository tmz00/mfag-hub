import { createSignal } from "solid-js";

export type FilterMode = "all" | "mine";

export const DEFAULT_CLOSINGS_PERIOD = "today";
export const DEFAULT_CLOSINGS_FILTER_MODE: FilterMode = "all";

export const [selectedPeriod, setSelectedPeriod] = createSignal(
  DEFAULT_CLOSINGS_PERIOD,
);
export const [filterMode, setFilterMode] = createSignal<FilterMode>(
  DEFAULT_CLOSINGS_FILTER_MODE,
);

export const resetClosingsListView = () => {
  setSelectedPeriod(DEFAULT_CLOSINGS_PERIOD);
  setFilterMode(DEFAULT_CLOSINGS_FILTER_MODE);
};
