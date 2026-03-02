import type { ClosingDraft, DraftProduct } from "./SubmitClosing";

/**
 * Module-level state that persists while navigating between
 * /closings/submit and /closings/submit/plan.
 */

interface SavedSubmitState {
  draft: ClosingDraft;
  submittedBy: { fscCode: string; nickname: string } | null;
  initialSnapshot: string;
  snapshotReady: boolean;
  returnUrl: string;
}

let _saved: SavedSubmitState | null = null;

export function saveSubmitState(state: SavedSubmitState) {
  _saved = state;
}

export function getSavedState(): SavedSubmitState | null {
  return _saved;
}

export function updateSavedDraft(updater: (d: ClosingDraft) => ClosingDraft) {
  if (_saved) {
    _saved = { ..._saved, draft: updater(_saved.draft) };
  }
}

export function clearSavedState() {
  _saved = null;
  _editPlan = null;
  _pendingScrollToAddNewBusiness = false;
}

// ---- Edit plan page communication ----

interface EditPlanParams {
  product: DraftProduct;
  index: number | null;
  isAddon: boolean;
}

let _editPlan: EditPlanParams | null = null;

export function setEditPlan(params: EditPlanParams) {
  _editPlan = params;
}

export function getEditPlan(): EditPlanParams | null {
  return _editPlan;
}

export function clearEditPlan() {
  _editPlan = null;
}

// ---- Pending highlight after returning from EditPlan ----

let _pendingHighlightProductId: string | null = null;

export function setPendingHighlightProductId(id: string | null) {
  _pendingHighlightProductId = id;
}

/** Read and clear in one call */
export function consumePendingHighlightProductId(): string | null {
  const id = _pendingHighlightProductId;
  _pendingHighlightProductId = null;
  return id;
}

// ---- Pending scroll target after returning from PlanEditor Back ----

let _pendingScrollToAddNewBusiness = false;

export function setPendingScrollToAddNewBusiness(value: boolean) {
  _pendingScrollToAddNewBusiness = value;
}

/** Read and clear in one call */
export function consumePendingScrollToAddNewBusiness(): boolean {
  const value = _pendingScrollToAddNewBusiness;
  _pendingScrollToAddNewBusiness = false;
  return value;
}
