import { Component, createMemo, createSignal, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";

import { PageShell, PageHeader, PageBody, LoadingState } from "../../components/ui";
import { teamService } from "../../services/teamService";
import { adminOptionLinks } from "./adminOptions";
import { dashboardOptions } from "../dashboard/dashboardOptions";

const Admin: Component = () => {
  const navigate = useNavigate();
  const [accessError, setAccessError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [isEditorOnly, setIsEditorOnly] = createSignal(false);

  onMount(async () => {
    const { accessLevel, isAdmin } = await teamService.getCurrentUserAccessLevel();
    const normalized = accessLevel.toLowerCase();
    if (!isAdmin && normalized !== "admin" && normalized !== "editor") {
      setAccessError("You do not have access to the admin area.");
      setLoading(false);
      return;
    }
    setIsEditorOnly(!isAdmin && normalized === "editor");
    setLoading(false);
  });

  const visibleOptions = createMemo(() => {
    const options = Object.values(adminOptionLinks);
    if (!isEditorOnly()) return options;
    const editorAllowed = new Set([
      "/admin/handbook",
      "/admin/products",
      "/admin/sources",
      "/admin/backups",
    ]);
    return options.filter((option) => editorAllowed.has(option.href));
  });

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate(-1)}
        icon={
          <Dynamic
            component={dashboardOptions.admin.icon}
            class="h-5 w-5"
          />
        }
        title={dashboardOptions.admin.title}
        subtitle={dashboardOptions.admin.description}
      />

      <PageBody><div class="space-y-4">
        {loading() ? (
          <div class="py-4">
            <LoadingState label="Loading admin tools..." />
          </div>
        ) : accessError() ? (
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700">
            {accessError()}
          </div>
        ) : (
          <div class="w-full max-w-2xl space-y-3">
            {visibleOptions().map((option) => (
              <A
                href={option.href}
                class="block w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-admin-from/40 hover:bg-admin-from/5"
              >
                <div class="flex items-start gap-3">
                  <option.icon class="mt-0.5 h-5 w-5 text-admin-from" />
                  <div>
                    <div class="text-base font-semibold text-gray-900">
                      {option.title}
                    </div>
                    <div class="text-base text-gray-500">
                      {option.description}
                    </div>
                  </div>
                </div>
              </A>
            ))}
          </div>
        )}
      </div></PageBody>
    </PageShell>
  );
};

export default Admin;
