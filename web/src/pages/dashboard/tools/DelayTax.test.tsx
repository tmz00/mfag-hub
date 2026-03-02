import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
};

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      {props.onBack ? (
        <button
          type="button"
          aria-label={props.backLabel || "Back"}
          onClick={props.onBack}
        >
          Back
        </button>
      ) : null}
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
}));

const renderDelayTax = async () => {
  vi.resetModules();
  const { default: DelayTax } = await import("./DelayTax");
  render(() => <DelayTax />);
};

const installClipboardMock = () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "share", {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    configurable: true,
  });

  return writeTextMock;
};

describe("Delay Tax tool", () => {
  it("renders from URL params and shares a URL", async () => {
    const writeTextMock = installClipboardMock();
    window.history.replaceState(
      {},
      "",
      "/tools/delay-tax?years=30&initial=15000&contribution=700&return=10&wait=4&freq=yearly",
    );

    await renderDelayTax();

    expect(screen.getByText("The Delay Tax")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getAllByText(/Your 4 Years Delay Tax/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("button", { name: "year" })).toBeTruthy();

    const shareButton = document.querySelector(
      "button.fixed.bottom-6.right-6",
    ) as HTMLButtonElement | null;
    expect(shareButton).toBeTruthy();
    if (!shareButton) return;

    fireEvent.click(shareButton);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });

    const shareUrl = String(writeTextMock.mock.calls[0]?.[0] ?? "");
    expect(shareUrl).toContain("years=30");
    expect(shareUrl).toContain("initial=15000");
    expect(shareUrl).toContain("contribution=700");
    expect(shareUrl).toContain("return=10");
    expect(shareUrl).toContain("wait=4");
    expect(shareUrl).toContain("freq=yearly");
  });

  it("shows warning when wait years exceed investment years", async () => {
    window.history.replaceState(
      {},
      "",
      "/tools/delay-tax?years=2&initial=1000&contribution=100&return=8&wait=5&freq=monthly",
    );

    await renderDelayTax();

    expect(
      screen.getByText("Investment years must be greater than wait years"),
    ).toBeTruthy();
  });

  it("shows a back button when opened from the dashboard", async () => {
    window.history.replaceState({}, "", "/tools/delay-tax");

    await renderDelayTax();

    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
