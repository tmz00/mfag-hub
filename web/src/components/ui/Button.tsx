import { Component, JSX, splitProps } from "solid-js";

type ButtonVariant = "primary" | "primaryOutline" | "primarySoft" | "secondary" | "admin" | "adminOutline" | "danger" | "dangerSolid" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: JSX.Element;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-linear-to-r from-primary-500 to-primary-500 via-primary-400 text-white shadow-sm hover:brightness-105",
  primaryOutline:
    "border border-primary/40 bg-white text-primary font-semibold shadow-sm hover:bg-primary/5 hover:border-primary/60",
  primarySoft:
    "border border-primary bg-primary/5 text-primary font-medium hover:bg-primary/10",
  secondary:
    "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
  admin:
    "bg-linear-to-r from-[var(--color-admin-from)] to-[var(--color-admin-to)] text-white shadow-sm hover:brightness-105",
  adminOutline:
    "border border-admin-from/40 text-admin-from hover:bg-admin-from/10",
  danger:
    "border border-red-200 text-red-600 hover:bg-red-50",
  dangerSolid:
    "bg-red-600 text-white shadow-sm hover:bg-red-700",
  ghost:
    "text-gray-600 hover:bg-gray-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-2.5 text-base",
};

export const Button: Component<ButtonProps> = (props) => {
  const [local, buttonProps] = splitProps(props, [
    "variant",
    "size",
    "fullWidth",
    "class",
    "children",
  ]);

  const variant = () => local.variant ?? "primary";
  const size = () => local.size ?? "md";

  return (
    <button
      {...buttonProps}
      class={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${
        variantClasses[variant()]
      } ${sizeClasses[size()]} ${local.fullWidth ? "w-full" : ""} ${local.class ?? ""}`}
    >
      {local.children}
    </button>
  );
};
