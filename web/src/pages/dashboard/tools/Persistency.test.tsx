import { fireEvent, render, screen } from "@solidjs/testing-library";
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

const renderPersistency = async () => {
  vi.resetModules();
  const { default: Persistency } = await import("./Persistency");
  render(() => <Persistency />);
};

describe("Persistency tool", () => {
  it("renders with URL params and computes monthly + forecast persistency", async () => {
    window.history.replaceState(
      {},
      "",
      "/tools/persistency?c19exp=100&c19lap=20&p24exp=10000&p24lap=2000&e19exp1=100&e19exp2=110&e19exp3=120&e19lap=20&e24exp1=9000&e24exp2=10000&e24exp3=11000&e24lap=2000",
    );

    await renderPersistency();

    expect(screen.getByText("Persistency")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    // Type cards in the overview tab show full names
    expect(screen.getByText("LIMRA-19 (Case Count)")).toBeTruthy();
    expect(screen.getByText("24-Month (Premium)")).toBeTruthy();

    // Navigate to the LIMRA-19 calculator to see computed values
    fireEvent.click(screen.getByRole("button", { name: "LIMRA-19" }));
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("81.8%")).toBeTruthy();
  });

  it("shows back button when opened without shared query", async () => {
    window.history.replaceState({}, "", "/tools/persistency");

    await renderPersistency();

    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
