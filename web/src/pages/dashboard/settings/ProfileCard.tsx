import { Component, Show, createSignal, onMount, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  TbOutlineBuilding,
  TbOutlineId,
  TbOutlineCalendar,
  TbOutlinePencil,
  TbOutlineShield,
} from "solid-icons/tb";
import { IconButton } from "../../../components/ui";
import { authService } from "../../../services/authService";
import { teamService, type TeamAgency } from "../../../services/teamService";

const ProfileCard: Component = () => {
  const navigate = useNavigate();
  const [nickname, setNickname] = createSignal("");
  const [fullName, setFullName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [agencyCode, setAgencyCode] = createSignal("");
  const [fscCode, setFscCode] = createSignal("");
  const [birthDate, setBirthDate] = createSignal("");
  const [contractDate, setContractDate] = createSignal("");
  const [agencies, setAgencies] = createSignal<TeamAgency[]>([]);
  const [accessLevel, setAccessLevel] = createSignal("");

  const pad2 = (value: number) => String(value).padStart(2, "0");

  const formatDateFromParts = (day?: number, month?: number, year?: number) => {
    if (!day || !month || !year) return "";
    return `${pad2(day)}/${pad2(month)}/${year}`;
  };

  const formatDateLong = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 8) return "–";
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const agencyName = createMemo(() => {
    const code = agencyCode();
    if (!code) return "";
    const agency = agencies().find((a) => a.code === code);
    return agency?.name || "";
  });

  const labelClass = "text-sm font-medium font-condensed uppercase tracking-wide text-gray-500";
  const valueClass = "text-lg font-semibold text-gray-900";

  onMount(async () => {
    const current = authService.getCurrentUser();
    if (!current) return;
    setEmail(current.email || "");
    await loadAgencies();
    await loadUserDoc(current.uid);
  });

  const loadUserDoc = async (uid: string) => {
    try {
      const profile = await teamService.getUserProfile(uid);
      if (!profile) return;
      setNickname(profile.nickname || "");
      setFullName(profile.fullName || "");
      setAgencyCode(profile.agencyCode || "");
      setFscCode(profile.fscCode || "");
      setAccessLevel(profile.accessLevel || "");
      setBirthDate(
        formatDateFromParts(
          profile.birthDay,
          profile.birthMonth,
          profile.birthYear,
        ),
      );
      setContractDate(
        formatDateFromParts(
          profile.contractDay,
          profile.contractMonth,
          profile.contractYear,
        ),
      );
    } catch (err) {
      console.error("Failed to load profile doc", err);
    }
  };

  const loadAgencies = async () => {
    try {
      const items = await teamService.getAgencies();
      setAgencies(items);
    } catch (err) {
      console.error("Failed to load agencies", err);
    }
  };

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      {/* Header Row */}
      <div class="space-y-0.5">
        <div class="flex items-start justify-between gap-2">
          <div class="text-lg font-semibold text-gray-900">
            {nickname() || "–"}
          </div>
          <IconButton
            variant="primary"
            onClick={() => navigate("/settings/edit-profile")}
            aria-label="Edit profile"
            title="Edit profile"
            size="md"
          >
            <TbOutlinePencil />
          </IconButton>
        </div>
        <div class="text-lg font-semibold text-gray-900">
          {fullName() || "–"}
        </div>
        <div class="text-base text-gray-500">{email() || "–"}</div>
      </div>

      {/* Info Grid */}
      <div class="grid gap-3 sm:grid-cols-2">
        {/* Agency */}
        <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
          <TbOutlineBuilding class="mt-0.75 h-5 w-5 shrink-0 text-gray-500" />
          <div class="min-w-0">
            <h3 class={labelClass}>
              Agency / FSC Code
            </h3>
            <div class={valueClass}>{agencyName() || agencyCode() || "–"}</div>
            <div class="text-base text-gray-500">
              {agencyCode() || "–"} / {fscCode() || "–"}
            </div>
          </div>
        </div>

        {/* Access Level */}
        <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
          <TbOutlineShield class="mt-0.75 h-5 w-5 shrink-0 text-gray-500" />
          <div class="min-w-0">
            <h3 class={labelClass}>
              Access Level
            </h3>
            <div class={`${valueClass} capitalize`}>
              {accessLevel() || "standard"}
            </div>
          </div>
        </div>

        {/* Birthdate */}
        <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
          <TbOutlineCalendar class="mt-0.75 h-5 w-5 shrink-0 text-gray-500" />
          <div class="min-w-0">
            <h3 class={labelClass}>
              Birthdate
            </h3>
            <div class={valueClass}>{formatDateLong(birthDate())}</div>
          </div>
        </div>

        {/* Contract Date */}
        <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
          <TbOutlineId class="mt-0.75 h-5 w-5 shrink-0 text-gray-500" />
          <div class="min-w-0">
            <h3 class={labelClass}>
              Contract Date
            </h3>
            <div class={valueClass}>{formatDateLong(contractDate())}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileCard;
