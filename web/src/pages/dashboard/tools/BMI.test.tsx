import { fireEvent, render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
}));

const renderBMI = async () => {
  vi.resetModules();
  const { default: BMI } = await import("./BMI");
  render(() => <BMI />);
};

describe("BMI tool", () => {
  it("shows default BMI and updates category when switching schemes", async () => {
    await renderBMI();

    expect(screen.getByText("BMI")).toBeTruthy();
    expect(screen.getByText("24.2")).toBeTruthy();
    expect(screen.getByText("Overweight (At Risk)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "WHO" }));

    expect(screen.getAllByText("Normal weight").length).toBeGreaterThan(0);
    expect(screen.queryByText("Overweight (At Risk)")).toBeNull();
  });

  it("updates underwriting status for high BMI", async () => {
    await renderBMI();

    const weightInput = screen.getByLabelText(/Weight \(kg\)/i);
    fireEvent.input(weightInput, { target: { value: "200" } });
    fireEvent.blur(weightInput);

    expect(screen.getByText("Insurance Underwriting")).toBeTruthy();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
  });
});
