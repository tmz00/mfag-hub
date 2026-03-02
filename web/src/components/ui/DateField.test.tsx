import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { DateField } from "./DateField";

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineCalendar: Icon,
    TbOutlineChevronLeft: Icon,
    TbOutlineChevronRight: Icon,
  };
});

const renderDateField = (initialValue = "2026-02-15") => {
  const [value, setValue] = createSignal(initialValue);
  return render(() => (
    <DateField
      id="test-date"
      value={value()}
      onChange={setValue}
    />
  ));
};

describe("DateField", () => {
  it("lets the calendar month and year be changed from dropdowns", () => {
    renderDateField();

    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));

    const monthSelect = screen.getByLabelText("Select month") as HTMLSelectElement;
    const yearSelect = screen.getByLabelText("Select year") as HTMLSelectElement;

    expect(monthSelect.value).toBe("1");
    expect(yearSelect.value).toBe("2026");

    fireEvent.change(monthSelect, { target: { value: "10" } });
    fireEvent.change(yearSelect, { target: { value: "2024" } });

    expect(monthSelect.value).toBe("10");
    expect(yearSelect.value).toBe("2024");
  });
});
