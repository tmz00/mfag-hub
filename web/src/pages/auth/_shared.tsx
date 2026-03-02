import { Component, Show, onCleanup, onMount } from "solid-js";
import { Button, PageShell } from "../../components/ui";

/**
 * Shared auth page components
 * Used by Login.tsx and OtpSignIn.tsx to maintain consistent UI
 */

export const _AuthContainer: Component<{ children: any }> = (props) => {
  onMount(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;

    const previous = meta.getAttribute("content");
    meta.setAttribute("content", "#f9fafb");

    onCleanup(() => {
      meta.setAttribute("content", previous || "#178e9e");
    });
  });

  return (
    <PageShell>
      <div class="min-h-dvh w-full flex items-center justify-center p-8">{props.children}</div>
    </PageShell>
  );
};

export const _AuthHeader: Component<{ title: string; subtitle: string }> = (props) => {
  return (
    <div class="bg-linear-to-r from-primary-500 to-primary-500 via-primary-400 **:px-8 py-6">
      <h2 class="text-2xl font-semibold text-white">{props.title}</h2>
      <p class="text-white text-base mt-1">{props.subtitle}</p>
    </div>
  );
};

export interface FormFieldProps {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  autocomplete?: string;
  value: string;
  error: string;
  disabled: boolean;
  required?: boolean;
  inputmode?: "email" | "search" | "none" | "decimal" | "numeric" | "tel" | "text" | "url";
  pattern?: string;
  onInput: (value: string) => void;
  onBlur?: () => void;
}

export const _FormField: Component<FormFieldProps> = (props) => {
  return (
    <div>
      <label for={props.id} class="mb-2 block text-base font-medium text-gray-700">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type}
        placeholder={props.placeholder}
        autocomplete={props.autocomplete}
        inputmode={props.inputmode}
        pattern={props.pattern}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onBlur={() => props.onBlur?.()}
        disabled={props.disabled}
        required={props.required}
        class={`w-full rounded-lg border px-4 py-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60 placeholder:font-normal ${
          props.error ? "border-red-500" : "border-gray-300"
        }`}
      />
      <Show when={props.error}>
        <p class="mt-1 text-sm text-red-600">{props.error}</p>
      </Show>
    </div>
  );
};

export const _SubmitButton: Component<{
  isLoading: boolean;
  disabled?: boolean;
  children: any;
}> = (props) => {
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      fullWidth
      disabled={props.isLoading || !!props.disabled}
      class="!rounded-lg !px-4 !py-3 !font-medium focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
    >
      {props.children}
    </Button>
  );
};
