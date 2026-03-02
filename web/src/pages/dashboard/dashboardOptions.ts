import type { Component } from "solid-js";
import {
  TbOutlineUsers,
  TbOutlinePackage,
  TbOutlineSettings,
  TbOutlineScale,
  TbOutlineHourglass,
  TbOutlinePlant,
  TbOutlineCrosshair,
  TbOutlineBell,
  TbOutlineShield,
} from "solid-icons/tb";

export type DashboardOption = {
  title: string;
  description: string;
  icon: Component<{ class?: string }>;
  href: string;
};

export const dashboardOptions: Record<string, DashboardOption> = {
  closings: {
    title: "Closings",
    description: "Aim for your targets!",
    icon: TbOutlineCrosshair,
    href: "/closings",
  },
  team: {
    title: "Team",
    description: "Celebrate with your team! 🎉",
    icon: TbOutlineUsers,
    href: "/team",
  },
  products: {
    title: "Products",
    description: "Browse plans and riders",
    icon: TbOutlinePackage,
    href: "/products",
  },
  notifications: {
    title: "Notifications",
    description: "Stay updated",
    icon: TbOutlineBell,
    href: "/notifications",
  },
  settings: {
    title: "Settings",
    description: "Update your preferences",
    icon: TbOutlineSettings,
    href: "/settings",
  },
  admin: {
    title: "Admin",
    description: "Manage app settings and data",
    icon: TbOutlineShield,
    href: "/admin",
  },
  bmi: {
    title: "BMI",
    description: "Check BMI and underwriting impact",
    icon: TbOutlineScale,
    href: "/tools/bmi",
  },
  delayTax: {
    title: "The Delay Tax",
    description: "See the cost of waiting to invest",
    icon: TbOutlineHourglass,
    href: "/tools/delay-tax",
  },
  compoundEffect: {
    title: "The Compound Effect",
    description: "Visualise the power of compound growth",
    icon: TbOutlinePlant,
    href: "/tools/compound-effect",
  },
};
