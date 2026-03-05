import {
  Component,
  createMemo,
  createSignal,
  Show,
  onCleanup,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";

import { Alert, Button, Spinner } from "../../components/ui";
import { email as validateEmail } from "../../utils/validators";
import { authService, validateFscCode } from "../../services/authService";
import { resetCurrentOriginSiteData } from "../../utils/resetSiteData";
import packageJson from "../../../package.json";
import {
  _AuthContainer,
  _AuthHeader,
  _FormField,
  _SubmitButton,
} from "./_shared";

const Login: Component = () => {
  const navigate = useNavigate();
  const version = (packageJson as any)?.version;

  // Form fields
  const [email, setEmail] = createSignal("");
  const [fscCode, setFscCode] = createSignal("");

  // Field errors
  const [emailError, setEmailError] = createSignal("");
  const [fscError, setFscError] = createSignal("");
  const [emailTouched, setEmailTouched] = createSignal(false);
  const [fscTouched, setFscTouched] = createSignal(false);

  // UI state
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [isResetting, setIsResetting] = createSignal(false);
  const [otpSent, setOtpSent] = createSignal(false);

  onMount(() => {
    const unsub = authService.onAuthStateChanged((user) => {
      if (user) {
        navigate("/", { replace: true });
      }
    });
    onCleanup(() => unsub && unsub());
  });

  const validateEmailField = (value: string): string => {
    const err = validateEmail(value);
    setEmailError(err);
    return err;
  };

  const validateFscField = (value: string): string => {
    const err = validateFscCode(value);
    setFscError(err);
    return err;
  };

  const handleRequestOtp = async (e: Event) => {
    e.preventDefault();
    setError("");
    setStatus("");
    setOtpSent(false);
    setEmailTouched(true);
    setFscTouched(true);

    // Validate form
    const emailErr = validateEmailField(email());
    const fscErr = validateFscField(fscCode());

    if (emailErr || fscErr) return;

    setIsLoading(true);

    try {
      setStatus("Verifying credentials...");
      const result = await authService.requestOtp({
        email: email(),
        fscCode: fscCode(),
      });

      if (!result.sent) {
        throw new Error("OTP send failed");
      }

      setOtpSent(true);
      setStatus("OTP sent. Check your email for the 6-digit OTP.");
      localStorage.setItem("otpEmail", email());
      localStorage.setItem("otpFscCode", fscCode());
      navigate("/auth/otp");
    } catch (e: any) {
      console.error("OTP request error:", e);
      setError(
        e?.message != "internal"
          ? e.message || "Something went wrong. Please try again"
          : "Something went wrong. Please try again",
      );
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmitOtpRequest = createMemo(() => {
    if (!emailTouched() || !fscTouched()) return false;
    return !validateEmail(email()) && !validateFscCode(fscCode());
  });

  const canShowResetButton = createMemo(() => {
    const message = String(error() || "").toLowerCase();
    return (
      message.includes("failed to fetch") ||
      message.includes("unable to reach server") ||
      message.includes("network")
    );
  });

  const handleResetAppData = async () => {
    if (isResetting()) return;

    setIsResetting(true);
    setError("");
    setStatus("Resetting local app data...");

    try {
      await resetCurrentOriginSiteData();
      setStatus("App data reset. Reloading...");
      window.location.replace("/login");
    } catch {
      window.location.reload();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <_AuthContainer>
      <div class="w-full max-w-md">
        <_BrandHeader version={version} />

        <div class="mt-8 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <_AuthHeader
            title="Sign In"
            subtitle="Enter your credentials to receive an OTP via your email"
          />

          <div class="p-8">
            <form onSubmit={handleRequestOtp} class="space-y-4">
              <_FormField
                id="email"
                label="Email Address"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                value={email()}
                error={emailError()}
                disabled={isLoading()}
                required
                onInput={(value) => {
                  setEmail(value);
                  if (emailTouched() || emailError()) {
                    validateEmailField(value);
                  }
                }}
                onBlur={() => {
                  setEmailTouched(true);
                  validateEmailField(email());
                }}
              />

              <_FormField
                id="fscCode"
                label="FSC Code"
                type="text"
                placeholder="Enter your FSC code"
                autocomplete="fscCode"
                value={fscCode()}
                error={fscError()}
                disabled={isLoading()}
                onInput={(value) => {
                  setFscCode(value);
                  if (fscTouched() || fscError()) {
                    validateFscField(value);
                  }
                }}
                onBlur={() => {
                  setFscTouched(true);
                  validateFscField(fscCode());
                }}
              />

              <_SubmitButton
                isLoading={isLoading()}
                disabled={!canSubmitOtpRequest()}
              >
                {isLoading() ? (
                  <span class="inline-flex items-center gap-2">
                    <Spinner class="h-4 w-4 text-white/80" />
                    Sending...
                  </span>
                ) : otpSent() ? (
                  "Resend OTP"
                ) : (
                  "Email OTP"
                )}
              </_SubmitButton>
            </form>

            {/* Status/Error Messages */}
            <Show when={error()}>
              <div class="pt-3">
                <Alert type="error">{error()}</Alert>
                <Show when={canShowResetButton()}>
                  <div class="mt-3 space-y-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      class="!w-full !rounded-lg"
                      disabled={isLoading() || isResetting()}
                      onClick={() => void handleResetAppData()}
                    >
                      {isResetting()
                        ? "Resetting app data..."
                        : "Reset app data and reload"}
                    </Button>
                    <p class="text-center text-xs text-gray-500">
                      If this still fails, clear site data for hub.mfag.sg and
                      hubapi.mfag.sg in browser settings.
                    </p>
                  </div>
                </Show>
              </div>{" "}
            </Show>

            <Show when={status()}>
              <div class="mt-3">
                <Alert type="success">{status()}</Alert>
              </div>
            </Show>
          </div>
        </div>

        <p class="text-center text-base mt-6">
          Having trouble signing in? Contact your leader for assistance.
        </p>
      </div>
    </_AuthContainer>
  );
};

/*******************************
 *
 * BEGIN page-specific subcomponents below
 *
 *******************************/

const _BrandHeader: Component<{ version?: string }> = (props) => {
  return (
    <div class="items-center flex flex-col gap-1">
      <img src="/images/hub_banner.png" alt="MFAG Hub Banner" class="w-100" />
      <Show when={props.version}>
        <span>Version {props.version}</span>
      </Show>
    </div>
  );
};

export default Login;
