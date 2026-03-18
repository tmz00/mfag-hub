import { ParentComponent, Show, createMemo, createResource } from "solid-js";

import { LoadingState } from "../../components/ui";
import { teamService } from "../../services/teamService";

type AdminAccessGateProps = {
  allowEditor?: boolean;
  deniedMessage?: string;
  loadingLabel?: string;
};

export const hasAdminAccess = (
  accessLevel: string,
  isAdmin: boolean,
  allowEditor = false,
) => {
  const normalized = accessLevel.trim().toLowerCase();
  if (isAdmin || normalized === "admin") {
    return true;
  }

  return allowEditor && normalized === "editor";
};

const AdminAccessGate: ParentComponent<AdminAccessGateProps> = (props) => {
  const [access] = createResource(() => teamService.getCurrentUserAccessLevel());
  const hasAccess = createMemo(() => {
    const current = access();
    if (!current) return false;
    return hasAdminAccess(
      current.accessLevel,
      current.isAdmin,
      Boolean(props.allowEditor),
    );
  });
  const errorMessage = createMemo(() => {
    if (props.deniedMessage) return props.deniedMessage;
    return props.allowEditor
      ? "You do not have access to this admin page."
      : "Only admins can access this page.";
  });

  return (
    <Show
      when={!access.loading}
      fallback={
        <div class="py-6">
          <LoadingState label={props.loadingLabel || "Loading admin tools..."} />
        </div>
      }
    >
      <Show
        when={hasAccess()}
        fallback={
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700">
            {access.error
              ? "Unable to verify admin access right now."
              : errorMessage()}
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  );
};

export default AdminAccessGate;
