import {
  Component,
  JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  fetchHandbookFile,
  isHandbookApiFileUrl,
} from "../services/handbookFilesService";

type Props = JSX.ImgHTMLAttributes<HTMLImageElement>;

export const AuthenticatedImage: Component<Props> = (props) => {
  const [resolvedSrc, setResolvedSrc] = createSignal("");
  const normalizedSrc = createMemo(() => String(props.src || "").trim());
  let activeSource = "";
  let activeObjectUrl = "";
  let requestVersion = 0;

  const revokeObjectUrl = (url: string) => {
    if (
      !url
      || typeof window === "undefined"
      || typeof window.URL?.revokeObjectURL !== "function"
    ) {
      return;
    }

    window.URL.revokeObjectURL(url);
  };

  createEffect(() => {
    const source = normalizedSrc();
    if (source === activeSource) {
      return;
    }

    activeSource = source;
    requestVersion += 1;
    const currentRequest = requestVersion;

    if (!source) {
      revokeObjectUrl(activeObjectUrl);
      activeObjectUrl = "";
      setResolvedSrc("");
      return;
    }

    if (!isHandbookApiFileUrl(source)) {
      revokeObjectUrl(activeObjectUrl);
      activeObjectUrl = "";
      setResolvedSrc(source);
      return;
    }

    if (
      typeof window === "undefined"
      || typeof window.URL?.createObjectURL !== "function"
    ) {
      revokeObjectUrl(activeObjectUrl);
      activeObjectUrl = "";
      setResolvedSrc(source);
      return;
    }

    void (async () => {
      try {
        const response = await fetchHandbookFile(source);
        if (!response.ok) {
          throw new Error(`Unable to load image (${response.status})`);
        }

        const blob = await response.blob();
        if (currentRequest !== requestVersion || source !== activeSource) {
          return;
        }

        const nextObjectUrl = window.URL.createObjectURL(blob);
        const previousObjectUrl = activeObjectUrl;
        activeObjectUrl = nextObjectUrl;
        setResolvedSrc(nextObjectUrl);
        revokeObjectUrl(previousObjectUrl);
      } catch {
        if (currentRequest !== requestVersion || source !== activeSource) {
          return;
        }

        revokeObjectUrl(activeObjectUrl);
        activeObjectUrl = "";
        setResolvedSrc("");
      }
    })();
  });

  onCleanup(() => {
    requestVersion += 1;
    revokeObjectUrl(activeObjectUrl);
  });

  return (
    <Show when={resolvedSrc()}>
      {(src) => <img {...props} src={src()} />}
    </Show>
  );
};
