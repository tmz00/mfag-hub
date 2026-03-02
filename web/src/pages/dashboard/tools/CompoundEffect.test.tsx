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

const renderCompoundEffect = async () => {
  vi.resetModules();
  const { default: CompoundEffect } = await import("./CompoundEffect");
  render(() => <CompoundEffect />);
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

describe("Compound Effect tool", () => {
  it("renders values from URL and toggles contribution frequency", async () => {
    window.history.replaceState(
      {},
      "",
      "/tools/compound-effect?initial=2000&contribution=100&return=12&years=10&freq=yearly",
    );

    await renderCompoundEffect();

    expect(screen.getByText("The Compound Effect")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByText("Final Amount After 10 Years")).toBeTruthy();
    expect(screen.getByRole("button", { name: "year" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "year" }));
    expect(screen.getByRole("button", { name: "month" })).toBeTruthy();
  });

  it("shares URL with current inputs", async () => {
    const writeTextMock = installClipboardMock();
    window.history.replaceState(
      {},
      "",
      "/tools/compound-effect?initial=7500&contribution=250&return=9&years=15&freq=monthly",
    );

    await renderCompoundEffect();

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
    expect(shareUrl).toContain("initial=7500");
    expect(shareUrl).toContain("contribution=250");
    expect(shareUrl).toContain("return=9");
    expect(shareUrl).toContain("years=15");
    expect(shareUrl).toContain("freq=monthly");
  });

  it("shows a back button when opened from the dashboard", async () => {
    window.history.replaceState({}, "", "/tools/compound-effect");

    await renderCompoundEffect();

    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
