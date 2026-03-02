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

  it("shows minimum-character guidance before rendering results", async () => {
    await renderModal();

    const searchInput = await screen.findByRole("searchbox");
    fireEvent.input(searchInput, { target: { value: "cr" } });

    await waitFor(() => {
      expect(
        screen.getByText("Type at least 3 characters to see results."),
      ).toBeTruthy();
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
});
