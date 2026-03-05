import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AnchorProps = {
  href?: string;
  onClick?: () => void;
  children?: JSX.Element;
  class?: string;
};

type LoadingProps = {
  label?: string;
};

const { getHandbookEntriesMock } = vi.hoisted(() => ({
  getHandbookEntriesMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  A: (props: AnchorProps) => (
    <a
      href={props.href}
      onClick={(event) => {
        event.preventDefault();
        props.onClick?.();
      }}
      class={props.class}
    >
      {props.children}
    </a>
  ),
}));

vi.mock("../../../components/ui", () => ({
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  IconButton: (props: any) => (
    <button
      type={props.type}
      class={props.class}
      aria-label={props["aria-label"]}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

vi.mock("../../../services/handbookContentService", () => ({
  getHandbookEntries: (...args: unknown[]) => getHandbookEntriesMock(...args),
}));

const renderModal = async (props: {
  isOpen?: boolean;
  closeOnResultClick?: boolean;
  renderAsPage?: boolean;
  initialCategory?: string;
} = {}) => {
  vi.resetModules();
  const { default: HandbookSearchModal } = await import("./HandbookSearchModal");
  const onClose = vi.fn();
  render(() => <HandbookSearchModal onClose={onClose} {...props} />);
  return { onClose };
};

describe("HandbookSearchModal", () => {
  beforeEach(() => {
    localStorage.clear();
    getHandbookEntriesMock.mockReset();
    getHandbookEntriesMock.mockResolvedValue([
      {
        category: "Protection",
        content:
          "<h2>Critical Illness</h2><p>Critical illness coverage protects your income.</p>",
      },
      {
        category: "Savings",
        content: "<p>Build long-term wealth through disciplined contributions.</p>",
      },
    ]);
  });

  it("stays quiet for short queries before results are eligible", async () => {
    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "cr" } });

    await waitFor(() => {
      expect(
        screen.queryByText("Type at least 3 characters to see results."),
      ).toBeNull();
      expect(screen.queryByText("Start typing to search across all handbook categories.")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("renders matching search results for handbook content", async () => {
    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "illness" } });

    const resultLinks = await screen.findAllByRole("link", { name: /protection/i });
    expect(resultLinks.length).toBeGreaterThan(0);
    expect(resultLinks[0]?.getAttribute("href")).toContain("/handbook/0");
    expect(
      resultLinks.some((resultLink) =>
        resultLink.getAttribute("href")?.includes("q=illness"),
      ),
    ).toBe(true);
  });

  it("shows no-match state for unmatched terms", async () => {
    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "zzzz" } });

    await waitFor(() => {
      expect(screen.getByText("No matching results.")).toBeTruthy();
    });
  });

  it("renders a back button that closes the search", async () => {
    const { onClose } = await renderModal();

    const backButton = await screen.findByRole("button", { name: /back/i });
    fireEvent.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("autofocuses the search input when opened", async () => {
    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("closes from back button while search input is focused", async () => {
    const { onClose } = await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.focus(searchInput);

    const backButton = await screen.findByRole("button", { name: /back/i });
    fireEvent.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not double-close when back press triggers both pointer and click", async () => {
    const { onClose } = await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.focus(searchInput);

    const backButton = await screen.findByRole("button", { name: /back/i });
    fireEvent.pointerDown(backButton);
    fireEvent.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides recent searches until at least one character is typed", async () => {
    localStorage.setItem(
      "dashboard_handbook_recent_searches",
      JSON.stringify(["illness", "income"]),
    );

    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    expect(screen.queryByText("illness")).toBeNull();

    fireEvent.focus(searchInput);
    expect(screen.queryByText("illness")).toBeNull();

    fireEvent.input(searchInput, { target: { value: "i" } });

    await waitFor(() => {
      expect(screen.getByText("illness")).toBeTruthy();
    });
  });

  it("does not store recent searches shorter than 3 characters", async () => {
    const { onClose } = await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "ab" } });

    const backButton = await screen.findByRole("button", { name: /back/i });
    fireEvent.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("dashboard_handbook_recent_searches")).toBe("[]");
  });

  it("calls onClose when a result is clicked", async () => {
    const { onClose } = await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "illness" } });

    const [firstResultLink] = await screen.findAllByRole("link", {
      name: /protection/i,
    });
    expect(firstResultLink).toBeTruthy();
    fireEvent.click(firstResultLink as HTMLAnchorElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("supports filtering results to a specific category", async () => {
    await renderModal({ initialCategory: "Protection" });

    const categoryFilter = await screen.findByRole("combobox", {
      name: /search in/i,
    });
    expect((categoryFilter as HTMLSelectElement).value).toBe("Protection");

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "build" } });

    await waitFor(() => {
      expect(screen.getByText("No matching results.")).toBeTruthy();
    });

    fireEvent.change(categoryFilter, { target: { value: "Savings" } });

    const resultLinks = await screen.findAllByRole("link", { name: /savings/i });
    expect(resultLinks.length).toBeGreaterThan(0);
    expect(resultLinks[0]?.getAttribute("href")).toContain("/handbook/1");
  });
});
