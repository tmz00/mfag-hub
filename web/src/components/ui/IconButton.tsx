import { Component, JSX, splitProps } from "solid-js";

type IconButtonVariant = "default" | "primary" | "admin" | "adminOutline" | "danger" | "ghost";
type IconButtonSize = "sm" | "md" | "lg" | "xl";

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: JSX.Element;
}

const variantClasses: Record<IconButtonVariant, string> = {
  default:
    "hover:bg-gray-50",
  primary:
    "bg-linear-to-r from-primary-500 to-secondary-500 text-white shadow-sm hover:brightness-105",
  admin:
    "bg-linear-to-r from-[var(--color-admin-from)] to-[var(--color-admin-to)] text-white shadow-sm hover:brightness-105",
  adminOutline:
    "border border-admin-from/40 text-admin-from hover:bg-admin-from/10",
  danger:
    "border border-red-200 text-red-500 hover:bg-red-50",
  ghost:
    "text-gray-500 hover:bg-gray-100 hover:text-gray-600",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5",
  md: "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4",
  lg: "h-9 w-9 [&>svg]:h-5 [&>svg]:w-5",
  xl: "h-10 w-10 [&>svg]:h-6 [&>svg]:w-6",
};

export const IconButton: Component<IconButtonProps> = (props) => {
  const [local, buttonProps] = splitProps(props, [
    "variant",
    "size",
    "class",
    "children",
  ]);

  const variant = () => local.variant ?? "default";
  const size = () => local.size ?? "md";

  return (
    <button
      {...buttonProps}
      class={`flex items-center justify-center rounded-full transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${
        variantClasses[variant()]
      } ${sizeClasses[size()]} ${local.class ?? ""}`}
    >
      {local.children}
    </button>
  );
};
