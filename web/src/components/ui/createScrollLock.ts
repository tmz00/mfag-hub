import { createEffect, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

/**
 * Locks body scroll when the given signal is true.
 * Preserves and restores page scroll position on unlock.
 */
let activeLockCount = 0;
let savedScrollY = 0;
let savedBodyStyles:
  | {
      overflow: string;
      position: string;
      top: string;
      left: string;
      right: string;
      width: string;
      touchAction: string;
      overscrollBehavior: string;
    }
  | null = null;
let savedHtmlStyles:
  | {
      overflow: string;
      touchAction: string;
      overscrollBehavior: string;
    }
  | null = null;

const LOCKED_TOUCH_ACTION = "pinch-zoom";

const preventTouchMove = (event: TouchEvent) => {
  const target = event.target as Element | null;
  if (target?.closest("[data-scroll-lock-allow-touch='true']")) {
    return;
  }
  event.preventDefault();
};

const applyGlobalScrollLock = () => {
  if (typeof window === "undefined") return;
  const body = document.body;
  const html = document.documentElement;

  savedScrollY = window.scrollY || window.pageYOffset || 0;
  savedBodyStyles = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    touchAction: body.style.touchAction,
    overscrollBehavior: body.style.overscrollBehavior,
  };
  savedHtmlStyles = {
    overflow: html.style.overflow,
    touchAction: html.style.touchAction,
    overscrollBehavior: html.style.overscrollBehavior,
  };

  html.style.overflow = "hidden";
  // Keep document scrolling locked, but still allow pinch-zoom while a modal is open.
  html.style.touchAction = LOCKED_TOUCH_ACTION;
  html.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.touchAction = LOCKED_TOUCH_ACTION;
  body.style.overscrollBehavior = "none";
  document.addEventListener("touchmove", preventTouchMove, { passive: false });
};

const releaseGlobalScrollLock = () => {
  if (typeof window === "undefined" || !savedBodyStyles || !savedHtmlStyles) return;
  const body = document.body;
  const html = document.documentElement;

  document.removeEventListener("touchmove", preventTouchMove);
  html.style.overflow = savedHtmlStyles.overflow;
  html.style.touchAction = savedHtmlStyles.touchAction;
  html.style.overscrollBehavior = savedHtmlStyles.overscrollBehavior;
  body.style.overflow = savedBodyStyles.overflow;
  body.style.position = savedBodyStyles.position;
  body.style.top = savedBodyStyles.top;
  body.style.left = savedBodyStyles.left;
  body.style.right = savedBodyStyles.right;
  body.style.width = savedBodyStyles.width;
  body.style.touchAction = savedBodyStyles.touchAction;
  body.style.overscrollBehavior = savedBodyStyles.overscrollBehavior;
  window.scrollTo(0, savedScrollY);
  savedBodyStyles = null;
  savedHtmlStyles = null;
};

const acquireScrollLock = () => {
  if (activeLockCount === 0) {
    applyGlobalScrollLock();
  }
  activeLockCount += 1;
};

const releaseScrollLock = () => {
  if (activeLockCount <= 0) return;
  activeLockCount -= 1;
  if (activeLockCount === 0) {
    releaseGlobalScrollLock();
  }
};

export function createScrollLock(isLocked: Accessor<boolean>) {
  let lockHeldByInstance = false;

  createEffect(() => {
    if (typeof window === "undefined") return;
    const shouldLock = isLocked();

    if (shouldLock && !lockHeldByInstance) {
      acquireScrollLock();
      lockHeldByInstance = true;
    }
    if (!shouldLock && lockHeldByInstance) {
      releaseScrollLock();
      lockHeldByInstance = false;
    }

    onCleanup(() => {
      if (lockHeldByInstance) {
        releaseScrollLock();
        lockHeldByInstance = false;
      }
    });
  });
}
