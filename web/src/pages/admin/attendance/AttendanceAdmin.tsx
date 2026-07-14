import { Component } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import {
  TbOutlineCalendarCheck,
  TbOutlineHistory,
  TbOutlinePlus,
} from "solid-icons/tb";

import { PageBody, PageHeader, PageShell } from "../../../components/ui";

const AttendanceAdmin: Component = () => {
  const navigate = useNavigate();

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate("/admin")}
        icon={<TbOutlineCalendarCheck class="h-5 w-5" />}
        title="Attendance"
        subtitle="Create meeting QR codes and review attendance"
      />
      <PageBody>
        <div class="grid max-w-3xl gap-3 sm:grid-cols-2">
          <A
            href="/admin/attendance/create"
            class="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-admin-from/40 hover:bg-admin-from/5"
          >
            <div class="flex items-start gap-3">
              <TbOutlinePlus class="mt-0.5 h-5 w-5 text-admin-from" />
              <div>
                <div class="text-base font-semibold text-gray-900">Create Meeting</div>
                <div class="text-base text-gray-500">Set meeting details and generate a QR code.</div>
              </div>
            </div>
          </A>
          <A
            href="/admin/attendance/meetings"
            class="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-admin-from/40 hover:bg-admin-from/5"
          >
            <div class="flex items-start gap-3">
              <TbOutlineHistory class="mt-0.5 h-5 w-5 text-admin-from" />
              <div>
                <div class="text-base font-semibold text-gray-900">Past Meetings</div>
                <div class="text-base text-gray-500">View QR codes, attendance, and manual status changes.</div>
              </div>
            </div>
          </A>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default AttendanceAdmin;
