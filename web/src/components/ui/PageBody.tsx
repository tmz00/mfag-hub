import type { Component, JSX } from "solid-js";

type PageBodyProps = {
  children: JSX.Element;
};

export const PageBody: Component<PageBodyProps> = (props) => {
  return <div class="mx-auto max-w-7xl px-4 py-6">{props.children}</div>;
};
