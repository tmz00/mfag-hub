import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  navigateMock,
  useSearchParamsMock,
  capturedModalProps,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  capturedModalProps: { current: null as any },
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock("./HandbookSearchModal", () => ({
  default: (props: any) => {
    capturedModalProps.current = props;
    return (
      <button type="button" onClick={props.onClose}>
        Close
      </button>
    );
  },
}));

describe("HandbookSearch", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useSearchParamsMock.mockReset();
    capturedModalProps.current = null;
    window.history.replaceState({}, "", "/handbook/search");
  });

  it("navigates back to returnTo from location search params", async () => {
    useSearchParamsMock.mockReturnValue([{}, vi.fn()]);
    window.history.replaceState(
      {},
      "",
      "/handbook/search?category=Protection&replace=1&returnTo=%2Fhandbook%2F3%3Fq%3Dterm%26t%3Dline",
    );
    const { default: HandbookSearch } = await import("./HandbookSearch");

    render(() => <HandbookSearch />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(navigateMock).toHaveBeenCalledWith(
      "/handbook/3?q=term&t=line",
      { replace: true },
    );
  });
});
