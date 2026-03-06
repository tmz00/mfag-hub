import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterMode,
  resetClosingsListView,
  selectedPeriod,
  setFilterMode,
  setSelectedPeriod,
} from "../_closingsListViewState";
import type { ClosingProduct } from "../../../../services/closingsService";
import {
  calculateProductFyc as calculateSharedProductFyc,
  calculateProductAfyp as calculateSharedProductAfyp,
} from "../../../../utils/closingMetrics";

type WrapperProps = {
  children?: JSX.Element;
};

type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
  onBack?: () => void;
};

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  hideCancel?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
};

type SourcePickerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: {
    sourceId: string;
    sourceLabel: string;
    sourceItemId?: string;
    sourceItemLabel?: string;
  }) => void;
};

type PlansSectionProps = {
  draft: {
    products: unknown[];
  };
  setDraft: (updater: (draft: any) => any) => void;
};

const {
  navigateMock,
  onAuthStateChangedMock,
  unsubscribeMock,
  getUserFscCodeMock,
  getUserProfileMock,
  getSourcesMock,
  getProductsMock,
  createClosingMock,
  updateClosingMock,
  getClosingByIdMock,
  deleteClosingMock,
  skipGuardMock,
  searchParamsState,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  onAuthStateChangedMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  getUserFscCodeMock: vi.fn(),
  getUserProfileMock: vi.fn(),
  getSourcesMock: vi.fn(),
  getProductsMock: vi.fn(),
  createClosingMock: vi.fn(),
  updateClosingMock: vi.fn(),
  getClosingByIdMock: vi.fn(),
  deleteClosingMock: vi.fn(),
  skipGuardMock: vi.fn(),
  searchParamsState: {
    value: {} as Record<string, string | undefined>,
  },
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineFilePlus: Icon,
    TbOutlineSearch: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [searchParamsState.value],
}));

vi.mock("../../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <button type="button" onClick={props.onBack}>
        Back
      </button>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  Alert: (props: WrapperProps) => <div>{props.children}</div>,
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  LoadingState: (props: { label?: string }) => <div>{props.label || "Loading..."}</div>,
  Spinner: () => <div>Loading...</div>,
  createNavigationGuard: () => ({
    GuardModal: () => null,
    guardNavigate: (callback: () => void) => callback(),
    skipGuard: () => skipGuardMock(),
  }),
  createConfirm: () => [() => null, async () => true],
  ConfirmModal: (props: ConfirmModalProps) =>
    props.open ? (
      <div>
        <p>{props.title}</p>
        <p>{props.message}</p>
        <button type="button" onClick={() => void props.onConfirm?.()}>
          {props.confirmLabel}
        </button>
        {props.hideCancel ? null : (
          <button type="button" onClick={props.onCancel}>
            {props.cancelLabel || "Cancel"}
          </button>
        )}
      </div>
    ) : null,
}));

vi.mock("../../../../services/authService", () => ({
  authService: {
    onAuthStateChanged: (...args: unknown[]) => onAuthStateChangedMock(...args),
  },
}));

vi.mock("../../../../services/teamService", () => ({
  teamService: {
    getUserFscCode: (...args: unknown[]) => getUserFscCodeMock(...args),
    getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
  },
}));

vi.mock("../../../../services/sourcesService", () => ({
  sourcesService: {
    getSources: (...args: unknown[]) => getSourcesMock(...args),
  },
}));

vi.mock("../../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
  },
}));

vi.mock("../../../../services/closingsService", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../services/closingsService")>(
      "../../../../services/closingsService",
    );

  return {
    ...actual,
    closingsService: {
      getClosingById: (...args: unknown[]) => getClosingByIdMock(...args),
      createClosing: (...args: unknown[]) => createClosingMock(...args),
      updateClosing: (...args: unknown[]) => updateClosingMock(...args),
      deleteClosing: (...args: unknown[]) => deleteClosingMock(...args),
    },
  };
});

vi.mock("../_closingDisplay", async () => {
  const actual =
    await vi.importActual<typeof import("../_closingDisplay")>(
      "../_closingDisplay",
    );

  return {
    ...actual,
    buildClosingDisplayModel: (input: unknown) => input,
  };
});

vi.mock("../_ClosingDisplayBlock", () => ({
  default: (props: { model: { primaryName?: string } }) => (
    <div data-testid="closing-preview">{props.model.primaryName || "Unknown"}</div>
  ),
}));

vi.mock("./_FscPicker", () => ({
  default: () => null,
}));

vi.mock("./SourcePicker", () => ({
  default: (props: SourcePickerProps) => (
    <button
      type="button"
      onClick={() => {
        props.onSelect({
          sourceId: "warm",
          sourceLabel: "Warm",
        });
        props.onClose();
      }}
    >
      Set warm source
    </button>
  ),
}));

vi.mock("./PlansSection", () => ({
  default: (props: PlansSectionProps) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.setDraft((draft: any) => ({
            ...draft,
            products: [
              ...draft.products,
              {
                id: "plan-1",
                isRider: false,
                productId: "PLAN-1",
                fullName: "Starter Plan",
                shortName: "Starter",
                type: "regular",
                fycRate: 12,
                gst: false,
                premiumRows: [
                  {
                    id: "row-1",
                    premium: 100,
                    frequency: "Annual",
                    quantity: 2,
                  },
                ],
                riders: [
                  {
                    id: "rider-1",
                    isRider: true,
                    productId: "RIDER-1",
                    fullName: "Booster Rider",
                    shortName: "Booster",
                    fycRate: -1,
                    gst: false,
                    premiumRows: [
                      {
                        id: "rider-row-1",
                        premium: 20,
                        frequency: "Annual",
                        quantity: 1,
                      },
                    ],
                    riders: [],
                  },
                ],
              },
            ],
          }))
        }
      >
        Add test plan
      </button>
      <p>{props.draft.products.length} plans</p>
    </div>
  ),
}));

import SubmitClosing, {
  applyAttachedSuffixesFromCatalog,
  calculateProductFYC,
  calculateProductFYP,
  calculateTotals,
  type ClosingDraft,
  type DraftProduct,
} from "./SubmitClosing";

describe("SubmitClosing", () => {
  const toClosingProduct = (
    draft: DraftProduct,
    parentRate?: number,
  ): ClosingProduct => {
    const effectiveRate = draft.fycRate === -1 ? parentRate || 0 : draft.fycRate;
    return {
      isRider: draft.isRider,
      productId: draft.productId,
      fullName: draft.fullName,
      shortName: draft.shortName,
      type: draft.type,
      fycRate: effectiveRate,
      gst: draft.gst ? 9 : 0,
      quantitiesAndPremiums: (draft.premiumRows || []).map((row) => ({
        quantity: row.quantity || 1,
        premium: row.premium,
        frequency: row.frequency || undefined,
      })),
      riders: (draft.riders || []).map((rider) =>
        toClosingProduct(rider, effectiveRate),
      ),
    };
  };

  const buildDraftProduct = (
    overrides: Partial<DraftProduct> = {},
  ): DraftProduct => ({
    id: "plan-1",
    isRider: false,
    productId: "PLAN-1",
    fullName: "Starter Plan",
    shortName: "Starter",
    type: "regular",
    fycRate: 10,
    gst: false,
    premiumRows: [],
    riders: [],
    ...overrides,
  });

  beforeAll(() => {
    if (!globalThis.requestAnimationFrame) {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        writable: true,
        value: (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(performance.now()), 0),
      });
    }
  });

  beforeEach(() => {
    resetClosingsListView();
    searchParamsState.value = {};
    navigateMock.mockReset();
    onAuthStateChangedMock.mockReset();
    unsubscribeMock.mockReset();
    getUserFscCodeMock.mockReset();
    getUserProfileMock.mockReset();
    getSourcesMock.mockReset();
    getProductsMock.mockReset();
    createClosingMock.mockReset();
    updateClosingMock.mockReset();
    getClosingByIdMock.mockReset();
    deleteClosingMock.mockReset();
    skipGuardMock.mockReset();

    onAuthStateChangedMock.mockImplementation((callback: (user: any) => void) => {
      void callback({ uid: "user-1" });
      return unsubscribeMock;
    });
    getUserFscCodeMock.mockResolvedValue("FSC-100");
    getUserProfileMock.mockResolvedValue({
      nickname: "Agent Ace",
    });
    getSourcesMock.mockResolvedValue([
      {
        id: "warm",
        label: "Warm",
        children: [],
      },
    ]);
    getProductsMock.mockResolvedValue({ riders: [] });
    createClosingMock.mockResolvedValue("closing-1");
    updateClosingMock.mockResolvedValue(undefined);
    getClosingByIdMock.mockResolvedValue(null);
    deleteClosingMock.mockResolvedValue(undefined);
  });

  it("calculates shared totals and excludes add-on plans from case count", () => {
    const draft: ClosingDraft = {
      sourceId: "warm",
      sourceLabel: "Warm",
      sourceItemId: "",
      sourceItemLabel: "",
      sourceComment: "",
      products: [
        {
          id: "plan-1",
          isRider: false,
          productId: "PLAN-1",
          fullName: "Starter Plan",
          shortName: "Starter",
          fycRate: 10,
          gst: false,
          premiumRows: [
            {
              id: "row-1",
              premium: 100,
              frequency: "Annual",
              quantity: 2,
            },
          ],
          riders: [],
        },
        {
          id: "plan-2",
          isRider: true,
          productId: "PLAN-2",
          fullName: "Add On Booster",
          shortName: "Add On Booster",
          fycRate: 20,
          gst: false,
          premiumRows: [
            {
              id: "row-2",
              premium: 50,
              frequency: "Annual",
              quantity: 3,
            },
          ],
          riders: [],
        },
      ],
      sharedFscCode: "FSC-200",
      sharedFscName: "Agent Two",
      sharedFscNone: false,
      referrals: 2,
      referralsComment: "",
    };

    expect(calculateTotals(draft)).toEqual({
      totalFYP: 175,
      totalFYC: 25,
      caseCount: 1,
      isShared: true,
      originalFYP: 350,
      originalFYC: 50,
      originalCaseCount: 2,
    });
  });

  it("keeps submit helper FYC/AFYP aligned with shared metrics across critical scenarios", () => {
    const cases: Array<{
      label: string;
      product: DraftProduct;
      expectedFyc: number;
      expectedAfyp: number;
    }> = [
      {
        label: "Mthly-1 without GST",
        product: buildDraftProduct({
          premiumRows: [
            { id: "row-1", premium: 100, frequency: "Mthly-1", quantity: 1 },
          ],
        }),
        expectedFyc: 10,
        expectedAfyp: 1200,
      },
      {
        label: "Mthly-2 without GST",
        product: buildDraftProduct({
          premiumRows: [
            { id: "row-1", premium: 100, frequency: "Mthly-2", quantity: 1 },
          ],
        }),
        expectedFyc: 20,
        expectedAfyp: 1200,
      },
      {
        label: "Annual with GST",
        product: buildDraftProduct({
          gst: true,
          premiumRows: [
            { id: "row-1", premium: 109, frequency: "Annual", quantity: 1 },
          ],
        }),
        expectedFyc: 10,
        expectedAfyp: 100,
      },
      {
        label: "Base + rider",
        product: buildDraftProduct({
          premiumRows: [
            { id: "row-1", premium: 100, frequency: "Annual", quantity: 1 },
          ],
          riders: [
            buildDraftProduct({
              id: "rider-1",
              isRider: true,
              productId: "RIDER-1",
              fullName: "Booster Rider",
              shortName: "Booster",
              fycRate: 5,
              premiumRows: [
                { id: "rider-row-1", premium: 50, frequency: "Annual", quantity: 2 },
              ],
              riders: [],
            }),
          ],
        }),
        expectedFyc: 15,
        expectedAfyp: 200,
      },
      {
        label: "Single base + rider uses single multiplier",
        product: buildDraftProduct({
          type: "single",
          premiumRows: [
            { id: "row-1", premium: 100, frequency: "Annual", quantity: 1 },
          ],
          riders: [
            buildDraftProduct({
              id: "rider-2",
              isRider: true,
              productId: "RIDER-2",
              fullName: "Single Rider",
              shortName: "Single Rider",
              fycRate: 5,
              premiumRows: [
                { id: "rider-row-2", premium: 50, frequency: "Annual", quantity: 2 },
              ],
              riders: [],
            }),
          ],
        }),
        expectedFyc: 15,
        expectedAfyp: 20,
      },
    ];

    for (const testCase of cases) {
      const submitFyc = calculateProductFYC(testCase.product);
      const submitAfyp = calculateProductFYP(testCase.product);
      const sharedProduct = toClosingProduct(testCase.product);
      const sharedFyc = calculateSharedProductFyc(sharedProduct);
      const sharedAfyp = calculateSharedProductAfyp(sharedProduct);

      expect(submitFyc, `${testCase.label} submit FYC`).toBeCloseTo(
        testCase.expectedFyc,
        6,
      );
      expect(submitAfyp, `${testCase.label} submit AFYP`).toBeCloseTo(
        testCase.expectedAfyp,
        6,
      );
      expect(sharedFyc, `${testCase.label} shared FYC`).toBeCloseTo(
        testCase.expectedFyc,
        6,
      );
      expect(sharedAfyp, `${testCase.label} shared AFYP`).toBeCloseTo(
        testCase.expectedAfyp,
        6,
      );
    }
  });

  it("submits a valid closing with a normalized payload", async () => {
    const view = render(() => <SubmitClosing />);

    await waitFor(() => {
      expect(screen.getByText("Agent Ace")).toBeTruthy();
    });

    const submitButton = screen.getByRole("button", { name: "SUBMIT" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Set warm source" }));

    fireEvent.click(screen.getByRole("button", { name: "Add test plan" }));

    const referralsInput = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(referralsInput, { target: { value: "3" } });

    await waitFor(() => {
      expect(submitButton.disabled).toBe(false);
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(createClosingMock).toHaveBeenCalledTimes(1);
    });

    const [payload] = createClosingMock.mock.calls[0] as [Record<string, any>];

      expect(payload).toEqual(
      expect.objectContaining({
        timestamp: expect.any(Date),
        fscCode: "FSC-100",
        fscName: "Agent Ace",
        isShared: false,
        sourceId: "warm",
        referrals: 3,
        updatedBy: "Agent Ace",
        updatedAt: expect.any(String),
      }),
    );
    expect(payload.items).toEqual([
      {
        productId: "PLAN-1",
        fullName: "Starter Plan",
        shortName: "Starter",
        type: "regular",
        fycRate: 12,
        gst: 0,
        quantitiesAndPremiums: [
          {
            quantity: 2,
            premium: 100,
            frequency: "Annual",
          },
        ],
        riders: [
          {
            isRider: true,
            productId: "RIDER-1",
            fullName: "Booster Rider",
            shortName: "Booster",
            fycRate: 12,
            gst: 0,
            quantitiesAndPremiums: [
              {
                quantity: 1,
                premium: 20,
                frequency: "Annual",
              },
            ],
            riders: [],
          },
        ],
      },
    ]);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(skipGuardMock).not.toHaveBeenCalled();

    view.unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("resets the closing list view state to today and all", () => {
    setSelectedPeriod("2026-02");
    setFilterMode("mine");

    resetClosingsListView();

    expect(selectedPeriod()).toBe("today");
    expect(filterMode()).toBe("all");
  });

  it("backfills rider attached suffix labels from catalog data", () => {
    const products: DraftProduct[] = [
      {
        id: "plan-1",
        isRider: false,
        productId: "PLAN-1",
        fullName: "Starter Plan",
        shortName: "Starter",
        fycRate: 10,
        gst: false,
        premiumRows: [],
        riders: [
          {
            id: "rider-1",
            isRider: true,
            productId: "RIDER-1",
            fullName: "Booster Rider",
            shortName: "Booster",
            fycRate: 5,
            gst: false,
            premiumRows: [],
            riders: [],
          },
          {
            id: "rider-2",
            isRider: true,
            productId: "RIDER-2",
            fullName: "Shield Rider",
            shortName: "Shield",
            attachedSuffix: "[S]",
            fycRate: 5,
            gst: false,
            premiumRows: [],
            riders: [],
          },
        ],
      },
    ];

    const patched = applyAttachedSuffixesFromCatalog(products, {
      "RIDER-1": "[B]",
      "RIDER-2": "[IGNORED]",
    });

    expect(patched[0].riders[0].attachedSuffix).toBe("[B]");
    expect(patched[0].riders[1].attachedSuffix).toBe("[S]");
  });
});
