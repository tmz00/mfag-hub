import { Component, JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineAlertCircle,
  TbOutlineCircleCheck,
  TbOutlineX,
} from "solid-icons/tb";

interface AlertProps {
  type?: "error" | "success" | "info";
  children: JSX.Element;
}

export const Alert: Component<AlertProps> = (props) => {
  const config = () => {
    switch (props.type) {
      case "error":
        return {
          bg: "bg-red-50",
          border: "border-red-200",
          text: "text-red-800",
          iconColor: "text-red-600",
          icon: TbOutlineX,
        };
      case "success":
        return {
          bg: "bg-primary-50",
          border: "border-primary-200",
          text: "text-primary-800",
          iconColor: "text-primary-600",
          icon: TbOutlineCircleCheck,
        };
      default: // info
        return {
          bg: "bg-blue-50",
          border: "border-blue-200",
          text: "text-blue-800",
          iconColor: "text-blue-600",
          icon: TbOutlineAlertCircle,
        };
    }
  };

  return (
    <div
      class={`flex w-full items-center gap-4 rounded-xl border ${config().bg} ${config().border} px-4 py-3 shadow-lg`}
    >
      <Dynamic
        component={config().icon}
        class={`w-5 h-5 ${config().iconColor} shrink-0 mt-0.5`}
      />
      <p class={`flex-1 ${config().text} text-base`}>{props.children}</p>
    </div>
  );
};
