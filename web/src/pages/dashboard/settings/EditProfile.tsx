import {
  Component,
  For,
  Show,
  createSignal,
  onMount,
  createMemo,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  EditModal,
  ConfirmModal,
} from "../../../components/ui";
import { authService, type AuthUser } from "../../../services/authService";
import {
  teamService,
  type TeamAgency,
  type UpdateUserPayload,
} from "../../../services/teamService";

type EditProfileProps = {
  /** When true, user cannot go back without completing all fields */
  forceComplete?: boolean;
  onSaveSuccess?: () => void;
};

type FormSnapshot = {
  nickname: string;
  fullName: string;
  email: string;
  agencyCode: string;
  birthDate: string;
  contractDate: string;
};

const EditProfile: Component<EditProfileProps> = (props) => {
  const navigate = useNavigate();
  const [user, setUser] = createSignal<AuthUser | null>(null);
  const [nickname, setNickname] = createSignal("");
  const [fullName, setFullName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [agencyCode, setAgencyCode] = createSignal("");
  const [fscCode, setFscCode] = createSignal("");
  const [birthDate, setBirthDate] = createSignal("");
  const [contractDate, setContractDate] = createSignal("");
  const [agencies, setAgencies] = createSignal<TeamAgency[]>([]);
  const [accessLevel, setAccessLevel] = createSignal("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveResult, setSaveResult] = createSignal<{
    title: string;
    message: string;
    success: boolean;
  } | null>(null);
  const [initialNickname, setInitialNickname] = createSignal("");
  const [initialFullName, setInitialFullName] = createSignal("");
  const [initialEmail, setInitialEmail] = createSignal("");
  const [initialAgency, setInitialAgency] = createSignal("");
  const [initialBirthDate, setInitialBirthDate] = createSignal("");
  const [initialContractDate, setInitialContractDate] = createSignal("");
  const [touched, setTouched] = createSignal<Record<string, boolean>>({});
  const requiredFields = [
    "nickname",
    "fullName",
    "email",
    "agencyCode",
    "birthDate",
    "contractDate",
  ] as const;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const trimString = (value: any) => (value ?? "").toString().trim();
  const pad2 = (value: number) => String(value).padStart(2, "0");

  const formatDateFromParts = (day?: number, month?: number, year?: number) => {
    if (!day || !month || !year) return "";
    return `${pad2(day)}/${pad2(month)}/${year}`;
  };

  const formatDateInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) {
      return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const parseDateInput = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 8) return null;
    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));
    if (
      !day ||
      day > 31 ||
      !month ||
      month > 12 ||
      year < 1900 ||
      year > 2100
    ) {
      return null;
    }
    return { day, month, year };
  };

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));
  const isTouched = (field: string) => Boolean(touched()[field]);

  const nicknameError = createMemo(() =>
    !trimString(nickname()) ? "Nickname is required." : ""
  );
  const fullNameError = createMemo(() =>
    !trimString(fullName()) ? "Full name is required." : ""
  );
  const emailError = createMemo(() => {
    const value = trimString(email());
    if (!value) return "Email is required.";
    return emailRegex.test(value) ? "" : "Please enter a valid email.";
  });
  const agencyError = createMemo(() =>
    !trimString(agencyCode()) ? "Agency is required." : ""
  );
  const birthDateError = createMemo(() => {
    if (!trimString(birthDate())) return "Birthdate is required.";
    return parseDateInput(birthDate()) ? "" : "Birthdate must be DD/MM/YYYY.";
  });
  const contractDateError = createMemo(() => {
    if (!trimString(contractDate())) return "Contract date is required.";
    return parseDateInput(contractDate())
      ? ""
      : "Contract date must be DD/MM/YYYY.";
  });

  const isFormValid = createMemo(() => {
    const birthOk = Boolean(parseDateInput(birthDate()));
    const contractOk = Boolean(parseDateInput(contractDate()));
    return (
      !!trimString(nickname()) &&
      !!trimString(fullName()) &&
      !!trimString(email()) &&
      emailRegex.test(trimString(email())) &&
      !!trimString(agencyCode()) &&
      birthOk &&
      contractOk
    );
  });

  const fieldHasError = (field: string, error: string) =>
    isTouched(field) && !!error;

  const fieldClass = (hasError: boolean) =>
    `w-full rounded-lg border bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
      hasError
        ? "border-red-500 focus:border-red-500 focus:ring-red-200"
        : "border-gray-300 focus:border-primary focus:ring-primary/50"
    }`;

  const hasChanges = createMemo(() => {
    return (
      trimString(nickname()) !== trimString(initialNickname()) ||
      trimString(fullName()) !== trimString(initialFullName()) ||
      trimString(email()) !== trimString(initialEmail()) ||
      trimString(agencyCode()) !== trimString(initialAgency()) ||
      birthDate() !== initialBirthDate() ||
      contractDate() !== initialContractDate()
    );
  });

  const syncInitialFormState = (snapshot: FormSnapshot) => {
    setInitialNickname(snapshot.nickname);
    setInitialFullName(snapshot.fullName);
    setInitialEmail(snapshot.email);
    setInitialAgency(snapshot.agencyCode);
    setInitialBirthDate(snapshot.birthDate);
    setInitialContractDate(snapshot.contractDate);
  };

  onMount(async () => {
    const current = authService.getCurrentUser();
    if (!current) {
      navigate("/", { replace: true });
      return;
    }
    const currentEmail = current.email || "";
    setUser(current);
    setEmail(currentEmail);
    await loadAgencies();
    await loadUserDoc(current.uid, currentEmail);
  });

  const loadUserDoc = async (uid: string, initialEmail = "") => {
    try {
      const profile = await teamService.getUserProfile(uid);
      if (profile) {
        const nick = profile.nickname || "";
        const name = profile.fullName || "";
        const agency = profile.agencyCode || "";
        const fsc = profile.fscCode || "";
        setNickname(nick);
        setFullName(name);
        setAgencyCode(agency);
        setFscCode(fsc);
        setAccessLevel(profile.accessLevel || "");
        const birth = formatDateFromParts(
          profile.birthDay,
          profile.birthMonth,
          profile.birthYear,
        );
        const contract = formatDateFromParts(
          profile.contractDay,
          profile.contractMonth,
          profile.contractYear,
        );
        setBirthDate(birth);
        setContractDate(contract);
        syncInitialFormState({
          nickname: nick,
          fullName: name,
          email: initialEmail,
          agencyCode: agency,
          birthDate: birth,
          contractDate: contract,
        });
      }
    } catch (err) {
      console.error("Failed to load profile doc", err);
    } finally {
      if (props.forceComplete) {
        setTouched(
          requiredFields.reduce<Record<string, boolean>>((acc, field) => {
            acc[field] = true;
            return acc;
          }, {}),
        );
      }
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

  const returnToSettings = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/settings", { replace: true });
  };

  const handleBack = () => {
    if (props.forceComplete) return;
    returnToSettings();
  };

  const handleLogout = async () => {
    await authService.signOut();
    navigate("/", { replace: true });
  };

  const handleSave = async (e?: Event) => {
    e?.preventDefault?.();
    const current = user();
    if (!current) return;

    if (
      !nickname().trim() ||
      !fullName().trim() ||
      !email().trim() ||
      !agencyCode().trim() ||
      !birthDate().trim() ||
      !contractDate().trim()
    ) {
      setSaveResult({
        title: "Unable to save",
        message: "All fields are required.",
        success: false,
      });
      return;
    }
    if (!emailRegex.test(email().trim())) {
      setSaveResult({
        title: "Unable to save",
        message: "Please enter a valid email.",
        success: false,
      });
      return;
    }

    const parsedBirth = parseDateInput(birthDate());
    if (!parsedBirth) {
      setSaveResult({
        title: "Unable to save",
        message: "Birthdate must be in DD/MM/YYYY format.",
        success: false,
      });
      return;
    }
    const parsedContract = parseDateInput(contractDate());
    if (!parsedContract) {
      setSaveResult({
        title: "Unable to save",
        message: "Contract date must be in DD/MM/YYYY format.",
        success: false,
      });
      return;
    }

    const toIsoDate = (value: string) => {
      const parsed = parseDateInput(value);
      if (!parsed) return "";
      const pad2 = (num: number) => String(num).padStart(2, "0");
      return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
    };

    setIsSaving(true);
    try {
      const normalizedAccess =
        accessLevel().trim().toLowerCase() === "standard"
          ? ""
          : accessLevel().trim().toLowerCase();
      const trimmedEmail = email().trim();
      const trimmedNickname = nickname().trim();
      const trimmedFullName = fullName().trim();
      const trimmedAgencyCode = agencyCode().trim();
      const payload: UpdateUserPayload = {
        uid: current.uid,
        email: trimmedEmail,
        nickname: trimmedNickname,
        fullName: trimmedFullName,
        agencyCode: trimmedAgencyCode,
        fscCode: fscCode().trim(),
        accessLevel: normalizedAccess,
        birthDate: toIsoDate(birthDate()),
        contractDate: toIsoDate(contractDate()),
      };
      await teamService.updateUser(payload);
      syncInitialFormState({
        nickname: trimmedNickname,
        fullName: trimmedFullName,
        email: trimmedEmail,
        agencyCode: trimmedAgencyCode,
        birthDate: birthDate(),
        contractDate: contractDate(),
      });
      setSaveResult({
        title: "Profile updated",
        message: "Your profile was saved successfully.",
        success: true,
      });
    } catch (err: any) {
      console.error("Profile update failed", err);
      setSaveResult({
        title: "Update failed",
        message: "Could not update profile. Please try again.",
        success: false,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const title = props.forceComplete ? "Complete Your Profile" : "Edit Profile";

  return (
    <>
      <EditModal
        title={title}
        onClose={handleBack}
        onSave={() => handleSave()}
        saving={() => isSaving()}
        saveDisabled={isSaving() || !isFormValid() || !hasChanges()}
        saveVariant="primary"
        saveLabel="Save"
        savingLabel="Saving..."
        hasUnsavedChanges={() => !props.forceComplete && hasChanges()}
        bodyClass="pb-6 pt-4 px-4"
        hideBackButton={!!props.forceComplete}
      >
        <form onSubmit={handleSave} class="space-y-4">
          <Show when={props.forceComplete}>
            <div class="text-right">
              <button
                type="button"
                class="text-sm italic text-primary transition hover:text-primary-700"
                onClick={handleLogout}
              >
                {"Not your profile? Switch account >>"}
              </button>
            </div>
          </Show>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                Nickname
              </label>
              <input
                type="text"
                placeholder="Your nickname"
                value={nickname()}
                onInput={(e) => setNickname(e.currentTarget.value)}
                onBlur={() => markTouched("nickname")}
                disabled={isSaving()}
                required
                class={fieldClass(fieldHasError("nickname", nicknameError()))}
              />
              <Show when={isTouched("nickname") && !!nicknameError()}>
                <p class="mt-1 text-base text-red-600">{nicknameError()}</p>
              </Show>
            </div>
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                Full Name
              </label>
              <input
                type="text"
                placeholder="Your full name"
                value={fullName()}
                onInput={(e) => setFullName(e.currentTarget.value)}
                onBlur={() => markTouched("fullName")}
                disabled={isSaving()}
                class={fieldClass(fieldHasError("fullName", fullNameError()))}
              />
              <Show when={isTouched("fullName") && !!fullNameError()}>
                <p class="mt-1 text-base text-red-600">{fullNameError()}</p>
              </Show>
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-base font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              onBlur={() => markTouched("email")}
              disabled={isSaving()}
              required
              class={fieldClass(fieldHasError("email", emailError()))}
            />
            <Show when={isTouched("email") && !!emailError()}>
              <p class="mt-1 text-base text-red-600">{emailError()}</p>
            </Show>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                Agency
              </label>
              <select
                value={agencyCode()}
                onChange={(e) => setAgencyCode(e.currentTarget.value)}
                onBlur={() => markTouched("agencyCode")}
                disabled={isSaving()}
                required
                class={fieldClass(fieldHasError("agencyCode", agencyError()))}
              >
                <option value=""></option>
                <For each={agencies()}>
                  {(agency) => (
                    <option value={agency.code}>
                      {agency.code} {agency.name ? `— ${agency.name}` : ""}
                    </option>
                  )}
                </For>
              </select>
              <Show when={isTouched("agencyCode") && !!agencyError()}>
                <p class="mt-1 text-base text-red-600">{agencyError()}</p>
              </Show>
            </div>
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                FSC Code
              </label>
              <input
                type="text"
                value={fscCode()}
                disabled
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-500"
              />
            </div>
          </div>

          <div class="grid gap-4 grid-cols-2">
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                Birthdate
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={birthDate()}
                onInput={(e) =>
                  setBirthDate(formatDateInput(e.currentTarget.value))
                }
                onBlur={() => markTouched("birthDate")}
                disabled={isSaving()}
                required
                class={fieldClass(fieldHasError("birthDate", birthDateError()))}
              />
              <Show when={isTouched("birthDate") && !!birthDateError()}>
                <p class="mt-1 text-base text-red-600">{birthDateError()}</p>
              </Show>
            </div>
            <div>
              <label class="mb-1.5 block text-base font-medium text-gray-700">
                Contract Date
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={contractDate()}
                onInput={(e) =>
                  setContractDate(formatDateInput(e.currentTarget.value))
                }
                onBlur={() => markTouched("contractDate")}
                disabled={isSaving()}
                required
                class={fieldClass(
                  fieldHasError("contractDate", contractDateError()),
                )}
              />
              <Show when={isTouched("contractDate") && !!contractDateError()}>
                <p class="mt-1 text-base text-red-600">{contractDateError()}</p>
              </Show>
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-base font-medium text-gray-700">
              Access Level
            </label>
            <input
              type="text"
              value={accessLevel() || "standard"}
              disabled
              class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-500 capitalize"
            />
            <p class="mt-1 text-base text-gray-400">
              Access level is managed by admin.
            </p>
          </div>
        </form>
      </EditModal>

      <ConfirmModal
        open={!!saveResult()}
        title={saveResult()?.title || ""}
        message={saveResult()?.message || ""}
        confirmLabel="OK"
        hideCancel
        variant={saveResult()?.success ? "default" : "danger"}
        onConfirm={() => {
          const result = saveResult();
          setSaveResult(null);
          if (!result?.success) return;
          if (props.onSaveSuccess) {
            props.onSaveSuccess();
            return;
          }
          returnToSettings();
        }}
        onCancel={() => setSaveResult(null)}
      />
    </>
  );
};

export default EditProfile;
