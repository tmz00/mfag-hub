import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createScrollLock } from "./createScrollLock";

const Harness = () => {
  createScrollLock(() => true);
  return <div>locked</div>;
};

describe("createScrollLock", () => {
  it("allows pinch zoom while keeping document scrolling locked", () => {
    document.body.style.touchAction = "manipulation";
    document.body.style.position = "";
    document.body.style.overflow = "";
    document.documentElement.style.touchAction = "auto";

    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);

    const view = render(() => <Harness />);

    expect(document.documentElement.style.touchAction).toBe("pinch-zoom");
    expect(document.body.style.touchAction).toBe("pinch-zoom");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();

    expect(document.documentElement.style.touchAction).toBe("auto");
    expect(document.body.style.touchAction).toBe("manipulation");
    expect(document.body.style.position).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(scrollToSpy).toHaveBeenCalled();

    scrollToSpy.mockRestore();
  });
});
