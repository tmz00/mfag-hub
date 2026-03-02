import { Component, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineLogout,
  TbOutlineRefresh
} from "solid-icons/tb";
import { PageShell, PageHeader, PageBody, Button } from "../../../components/ui";
import ProfileCard from "./ProfileCard";

import { authService } from "../../../services/authService";
import packageJson from "../../../../package.json";
import { dashboardOptions } from "../dashboardOptions";
import { checkForAppUpdateAndReload } from "../../../utils/appUpdate";

const Settings: Component = () => {
  const navigate = useNavigate();
  const [refreshingPage, setRefreshingPage] = createSignal(false);
  const version = (packageJson as any)?.version;

  const handleLogout = async () => {
    await authService.signOut();
    navigate("/", { replace: true });
  };

  const handleRefreshPage = async () => {
    setRefreshingPage(true);
    await checkForAppUpdateAndReload();
  };

  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic
            component={dashboardOptions.settings.icon}
            class="h-5 w-5"
          />
        }
        title={dashboardOptions.settings.title}
        subtitle={dashboardOptions.settings.description}
      />

      <PageBody><div class="space-y-6">
        <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div class="flex flex-col items-center gap-3 text-center">
            <div class="flex max-w-75 items-center justify-center">
              <img src="/images/hub_banner.png" alt="MFAG Hub" />
            </div>
            <Show when={version}>
              <div class="text-base font-semibold text-gray-900">
                Version {version}
              </div>
            </Show>
            <Button
              variant="primaryOutline"
              onClick={handleRefreshPage}
              disabled={refreshingPage()}
            >
              <TbOutlineRefresh class="h-4 w-4" />
              Check for Updates
            </Button>
          </div>
        </div>

        <ProfileCard />

        <div class="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
          <h2 class="text-lg font-semibold text-gray-900 mb-3">Sign Out</h2>
          <p class="text-base text-gray-600 mb-4">
            Sign out of your account on this device
          </p>
          <div class="flex justify-center">
            <Button variant="danger" onClick={handleLogout}>
              <TbOutlineLogout class="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div></PageBody>
    </PageShell>
  );
};

export default Settings;
