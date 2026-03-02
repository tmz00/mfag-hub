import { Component } from "solid-js";

import { EditModal, ReorderList } from "../../../../components/ui";
import type { HandbookEntry } from "../handbookTypes";

type Props = {
  entries: HandbookEntry[];
  onClose: () => void;
  onMove: (from: number, to: number) => void;
  onSave: () => void;
  saving: boolean;
  hasChanges: boolean;
};

export const HandbookReorderModal: Component<Props> = (props) => {
  return (
    <EditModal
      title="Reorder Categories"
      onClose={props.onClose}
      onSave={props.onSave}
      saving={() => props.saving}
      saveDisabled={props.saving || !props.hasChanges}
      bodyClass="pb-6 pt-4"
    >
      <div class="space-y-3">
        <div class="pb-6 text-base">
          Change the order of handbook categories by moving the items up
          or down.<br /><br />
          This affects how categories are displayed in the dashboard.
        </div>

        <ReorderList
          items={props.entries}
          itemKey={(entry) => entry.category || "Untitled"}
          onMove={props.onMove}
          emptyMessage="No categories available."
          renderLabel={(entry) => (
            <div class="text-base font-semibold text-gray-900">
              {entry.category || "Untitled category"}
            </div>
          )}
        />
      </div>
    </EditModal>
  );
};
