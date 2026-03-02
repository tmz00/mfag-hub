import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type { JSX } from "solid-js";
import {
  TbOutlineCalendar,
  TbOutlineChevronLeft,
  TbOutlineChevronRight,
} from "solid-icons/tb";

type DateFieldProps = {
  id: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  class?: string;
  /** When true, the text field is read-only and tapping it immediately opens the calendar picker. */
  pickerOnly?: boolean;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = Array.from({ length: 12 }, (_, monthIndex) =>
  new Date(2024, monthIndex, 1).toLocaleDateString("en-GB", {
    month: "long",
  }),
);

function parseIsoDate(value?: string) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function toIsoDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplayDate(value?: string) {
  const date = parseIsoDate(value);
  if (!date) return "";

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()),
  ].join("/");
}

function normalizeDisplayInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseDisplayDate(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year)
  ) {
    return null;
  }

  return parseIsoDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfCalendarGrid(month: Date) {
  const start = startOfMonth(month);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(start, diff);
}

function isSameDay(left: Date | null, right: Date | null) {
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export const DateField: Component<DateFieldProps> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  const [isOpen, setIsOpen] = createSignal(false);
  const [textValue, setTextValue] = createSignal(formatDisplayDate(props.value));
  const [visibleMonth, setVisibleMonth] = createSignal(
    startOfMonth(parseIsoDate(props.value) || new Date()),
  );

  const minDate = createMemo(() => parseIsoDate(props.min));
  const maxDate = createMemo(() => parseIsoDate(props.max));
  const selectedDate = createMemo(() => parseIsoDate(props.value));
  const today = createMemo(() => {
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    return next;
  });
  const calendarDays = createMemo(() => {
    const firstCell = startOfCalendarGrid(visibleMonth());
    return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
  });
  const yearOptions = createMemo(() => {
    const currentYear = visibleMonth().getFullYear();
    const min = minDate();
    const max = maxDate();
    const minYear = min ? min.getFullYear() : null;
    const maxYear = max ? max.getFullYear() : null;
    const startYear =
      minYear !== null
        ? minYear
        : maxYear !== null
          ? Math.min(maxYear, currentYear - 25)
          : currentYear - 25;
    const endYear =
      maxYear !== null
        ? maxYear
        : minYear !== null
          ? Math.max(minYear, currentYear + 25)
          : currentYear + 25;

    return Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => String(startYear + index),
    );
  });

  createEffect(() => {
    setTextValue(formatDisplayDate(props.value));
  });

  createEffect(() => {
    const selected = selectedDate();
    if (selected && !isOpen()) {
      setVisibleMonth(startOfMonth(selected));
    }
  });

  const isDateDisabled = (date: Date) => {
    const min = minDate();
    const max = maxDate();
    if (min && date < min) return true;
    if (max && date > max) return true;
    return false;
  };

  const commitTextValue = () => {
    const nextText = textValue().trim();
    if (!nextText) {
      if (props.value) {
        props.onChange("");
      }
      return true;
    }

    const parsed = parseDisplayDate(nextText);
    if (!parsed || isDateDisabled(parsed)) {
      setTextValue(formatDisplayDate(props.value));
      return false;
    }

    const nextValue = toIsoDate(parsed);
    setTextValue(formatDisplayDate(nextValue));
    if (nextValue !== props.value) {
      props.onChange(nextValue);
    }
    return true;
  };

  const handleDocumentPointer = (event: MouseEvent | FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || !rootRef) return;
    if (rootRef.contains(target)) return;
    setIsOpen(false);
    commitTextValue();
  };

  const openCalendar = () => {
    const selected = selectedDate() || parseDisplayDate(textValue()) || today();
    setVisibleMonth(startOfMonth(selected));
    setIsOpen(true);
  };

  const selectDate = (date: Date) => {
    const nextValue = toIsoDate(date);
    setTextValue(formatDisplayDate(nextValue));
    if (nextValue !== props.value) {
      props.onChange(nextValue);
    }
    setVisibleMonth(startOfMonth(date));
    setIsOpen(false);
  };

  onMount(() => {
    document.addEventListener("mousedown", handleDocumentPointer);
    document.addEventListener("focusin", handleDocumentPointer);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleDocumentPointer);
    document.removeEventListener("focusin", handleDocumentPointer);
  });

  return (
    <div ref={rootRef} class={`relative ${props.class || ""}`}>
      <div class="relative">
        <input
          id={props.id}
          type="text"
          inputMode={props.pickerOnly ? "none" : "numeric"}
          autocomplete="off"
          placeholder={props.placeholder || "DD/MM/YYYY"}
          value={textValue()}
          disabled={props.disabled}
          readOnly={props.pickerOnly}
          onClick={props.pickerOnly ? () => { if (!isOpen()) openCalendar(); } : undefined}
          onInput={props.pickerOnly ? undefined : (event) =>
            setTextValue(normalizeDisplayInput(event.currentTarget.value))
          }
          onBlur={props.pickerOnly ? undefined : () => {
            commitTextValue();
          }}
          onKeyDown={(event) => {
            if (props.pickerOnly) {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!isOpen()) openCalendar();
              } else if (event.key === "Escape") {
                setIsOpen(false);
              }
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              commitTextValue();
              setIsOpen(false);
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              openCalendar();
              return;
            }

            if (event.key === "Escape") {
              setTextValue(formatDisplayDate(props.value));
              setIsOpen(false);
            }
          }}
          class={`w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 pr-12 text-base text-gray-800 shadow-inner outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60${props.pickerOnly ? " cursor-pointer select-none" : ""}`}
        />

        <button
          type="button"
          class="absolute inset-y-1 right-1 inline-flex w-10 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
          aria-label="Open calendar"
          disabled={props.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (isOpen()) {
              setIsOpen(false);
              commitTextValue();
              return;
            }
            openCalendar();
          }}
        >
          <TbOutlineCalendar class="h-5 w-5" />
        </button>
      </div>

      <Show when={isOpen()}>
        <div class="absolute left-0 z-20 mt-2 w-full min-w-[20rem] rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
          <div class="mb-3 flex items-center gap-2">
            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="Previous month"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
            >
              <TbOutlineChevronLeft class="h-4 w-4" />
            </button>

            <div class="flex flex-1 items-center gap-2">
              <select
                aria-label="Select month"
                value={String(visibleMonth().getMonth())}
                onChange={(event) =>
                  setVisibleMonth((current) =>
                    new Date(
                      current.getFullYear(),
                      Number(event.currentTarget.value),
                      1,
                    ),
                  )
                }
                class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
              >
                <For each={MONTH_LABELS}>
                  {(label, monthIndex) => (
                    <option value={String(monthIndex())}>{label}</option>
                  )}
                </For>
              </select>

              <select
                aria-label="Select year"
                value={String(visibleMonth().getFullYear())}
                onChange={(event) =>
                  setVisibleMonth((current) =>
                    new Date(
                      Number(event.currentTarget.value),
                      current.getMonth(),
                      1,
                    ),
                  )
                }
                class="w-24 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
              >
                <For each={yearOptions()}>
                  {(year) => <option value={year}>{year}</option>}
                </For>
              </select>
            </div>

            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="Next month"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            >
              <TbOutlineChevronRight class="h-4 w-4" />
            </button>
          </div>

          <div class="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            <For each={WEEKDAY_LABELS}>
              {(label) => <div class="py-1">{label}</div>}
            </For>
          </div>

          <div class="mt-2 grid grid-cols-7 gap-1">
            <For each={calendarDays()}>
              {(date) => {
                const isCurrentMonth =
                  date.getMonth() === visibleMonth().getMonth() &&
                  date.getFullYear() === visibleMonth().getFullYear();
                const isSelected = isSameDay(date, selectedDate());
                const isToday = isSameDay(date, today());
                const disabled = isDateDisabled(date);

                return (
                  <button
                    type="button"
                    class={`inline-flex h-10 items-center justify-center rounded-xl text-sm transition focus:outline-none ${
                      isSelected
                        ? "bg-primary text-white shadow-sm"
                        : disabled
                          ? "cursor-not-allowed text-gray-300"
                          : isCurrentMonth
                            ? "text-gray-700 hover:bg-gray-100"
                            : "text-gray-400 hover:bg-gray-100"
                    } ${isToday && !isSelected ? "ring-1 ring-primary/20" : ""}`}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (!disabled) {
                        selectDate(date);
                      }
                    }}
                  >
                    {date.getDate()}
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
