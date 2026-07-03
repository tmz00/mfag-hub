import type { Component } from "solid-js";
import {
  TbOutlineChartBar,
  TbOutlineBell,
  TbOutlinePackage,
  TbOutlineUsers,
  TbOutlineBook,
  TbOutlineFileText,
  TbOutlineHistory,
  TbOutlineList,
  TbOutlinePlus,
  TbOutlinePencil,
  TbOutlineBuilding,
  TbOutlineArrowsUpDown,
} from "solid-icons/tb";

export type AdminOption = {
  title: string;
  description: string;
  icon: Component<{ class?: string }>;
  href: string;
};

export type AdminActionOption = {
  action: string;
  title: string;
  description: string;
  icon: Component<{ class?: string }>;
  class?: string;
};

export const adminActionButtonClass =
  "w-full cursor-pointer rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-admin-from/40 hover:bg-admin-from/5";

export const adminOptionLinks: Record<string, AdminOption> = {
  extractReports: {
    title: "Generate Reports",
    description: "Generate and download team performance reports",
    icon: TbOutlineChartBar,
    href: "/admin/reports",
  },
  reportTemplates: {
    title: "Manage Report Templates",
    description: "Configure the team performance report templates",
    icon: TbOutlineFileText,
    href: "/admin/report-templates",
  },
  notifications: {
    title: "Manage Notifications",
    description: "Create and send notifications, and manage past ones",
    icon: TbOutlineBell,
    href: "/admin/notifications",
  },
  attendance: {
    title: "Meeting Attendance",
    description: "Create meeting QR codes and track FSC attendance",
    icon: TbOutlineUsers,
    href: "/admin/attendance",
  },
  sources: {
    title: "Manage Closing Sources",
    description: "Configure sources (e.g. roadshow names) for closings",
    icon: TbOutlineList,
    href: "/admin/sources",
  },
  products: {
    title: "Manage Products",
    description: "Edit the product catalog, base plans, riders, and FYC rates",
    icon: TbOutlinePackage,
    href: "/admin/products",
  },
  team: {
    title: "Manage Team",
    description: "Add or edit team members, agencies, and access levels",
    icon: TbOutlineUsers,
    href: "/admin/team",
  },
  handbook: {
    title: "Manage Handbook",
    description: "Update handbook categories and content",
    icon: TbOutlineBook,
    href: "/admin/handbook",
  },
  backups: {
    title: "Manage Backups",
    description:
      "Restore recent section snapshots, manage uploaded file backups, and handle database backups for admins",
    icon: TbOutlineHistory,
    href: "/admin/backups",
  },
};

export const manageTeamActionOptions: AdminActionOption[] = [
  {
    action: "addUser",
    title: "Add User",
    description: "Create a new team user with FSC and access details.",
    icon: TbOutlinePlus,
  },
  {
    action: "editUser",
    title: "Edit User",
    description: "Select a user to update their details.",
    icon: TbOutlinePencil,
  },
  {
    action: "addAgency",
    title: "Add Agency",
    description: "Create a new agency code and name.",
    icon: TbOutlineBuilding,
  },
  {
    action: "editAgency",
    title: "Edit Agency",
    description: "Select an existing agency to edit or delete.",
    icon: TbOutlinePencil,
  },
  {
    action: "reorderAgencies",
    title: "Reorder Agencies",
    description: "Adjust the display order of agencies.",
    icon: TbOutlineArrowsUpDown,
  },
];

export const manageProductsActionOptions: AdminActionOption[] = [
  {
    action: "addBasePlan",
    title: "Add Base Plan",
    description:
      "Create a new base plan with FYC rules, frequencies, and attachable riders / top-up items. Riders / top-up items must be created first (using option below) before they can be attached.",
    icon: TbOutlinePlus,
  },
  {
    action: "addRider",
    title: "Add Rider / Top-up",
    description:
      "Create a rider or top-up item with its own FYC and frequencies rules.",
    icon: TbOutlinePlus,
  },
  {
    action: "editPlan",
    title: "Edit Plan / Rider / Top-up",
    description:
      "Browse and edit existing base plans or riders / top-up items.",
    icon: TbOutlinePencil,
  },
  {
    action: "reorderProducts",
    title: "Reorder Categories / Products",
    description:
      "Arrange how categories and items are displayed in the product list.",
    icon: TbOutlineArrowsUpDown,
  },
  {
    action: "editGstTypes",
    title: "Edit GST / Type Definitions",
    description:
      "Update the global GST rate and the type labels used across the catalog.",
    icon: TbOutlinePencil,
  },
];

export const manageHandbookActionOptions: AdminActionOption[] = [
  {
    action: "addCategory",
    title: "Add Category",
    description: "Create a new handbook category with image and content.",
    icon: TbOutlinePlus,
  },
  {
    action: "editCategory",
    title: "Edit Category",
    description: "Choose a category to update its image or content.",
    icon: TbOutlinePencil,
  },
  {
    action: "reorderCategories",
    title: "Reorder Categories",
    description: "Arrange how categories appear in the handbook list.",
    icon: TbOutlineArrowsUpDown,
  },
];

export const manageSourcesActionOptions: AdminActionOption[] = [
  {
    action: "addSource",
    title: "Add Source",
    description: "Create a new closing source with optional sub-items.",
    icon: TbOutlinePlus,
  },
  {
    action: "editSource",
    title: "Edit Source",
    description: "Select an existing source to update its details.",
    icon: TbOutlinePencil,
  },
  {
    action: "reorderSources",
    title: "Reorder Sources",
    description: "Arrange how sources appear in the closing form.",
    icon: TbOutlineArrowsUpDown,
  },
];

export const adminOptionForPath = (pathname: string) =>
  Object.values(adminOptionLinks).find(
    (option) =>
      pathname === option.href || pathname.startsWith(`${option.href}/`),
  );
