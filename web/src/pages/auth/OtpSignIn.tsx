import { Component, createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import { Alert, Button, Spinner } from "../../components/ui";
import { email as validateEmail } from "../../utils/validators";
import { authService, validateFscCode, validateOtp } from "../../services/authService";
import { _AuthContainer, _AuthHeader, _FormField, _SubmitButton } from "./_shared";

const OtpSignIn: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [otp, setOtp] = createSignal("");
  const [fscCode, setFscCode] = createSignal("");

  const [otpError, setOtpError] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  onMount(() => {
    const stored =
      localStorage.getItem("otpEmail") ||
      localStorage.getItem("emailForSignIn") ||
      "";
    if (stored) setEmail(stored);
    const storedFsc = localStorage.getItem("otpFscCode") || "";
    if (storedFsc) setFscCode(storedFsc);
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    setStatus("");

    // Validate email
    const emailErr = validateEmail(email());
    if (emailErr) return;

    // Validate OTP
    const otpErr = validateOtp(otp());
    if (otpErr) {
      setOtpError(otpErr);
      return;
    }
    setOtpError("");

    setIsLoading(true);
    try {
      setStatus("");
      await authService.verifyOtp({
        email: email(),
        otp: otp().trim(),
      });

      setStatus("Signed in successfully!");
      localStorage.removeItem("otpEmail");
      localStorage.removeItem("otpFscCode");
      setTimeout(() => navigate("/", { replace: true }), 500);
    } catch (e: any) {
      console.error("Code verification error:", e);
      setError(e?.message || "Something went wrong. Please try again");
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async (e: Event) => {
    e.preventDefault();
    setError("");
    setStatus("");

    const emailErr = validateEmail(email());
    const fscErr = validateFscCode(fscCode());
    if (emailErr || fscErr) {
      setError(emailErr || fscErr || "Invalid credentials");
      return;
    }

    setIsLoading(true);
    try {
      setStatus("Sending a new OTP...");
      const result = await authService.requestOtp({
        email: email(),
        fscCode: fscCode(),
      });
      if (!result.sent) {
        throw new Error("OTP send failed");
      }
      setStatus("New OTP sent.");
      localStorage.setItem("otpEmail", email());
    } catch (e: any) {
      console.error("OTP resend error:", e);
      setError(e?.message || "Something went wrong. Please try again");
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <_AuthContainer>
      <div class="w-full max-w-md">
        <div class="mt-8 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <_AuthHeader
            title="Enter OTP"
            subtitle="Check your email for the One-Time Password we sent you."
          />

          <div class="p-8 space-y-4">
            <form onSubmit={handleSubmit} class="space-y-4">
              <_FormField
                id="otp"
                label="6-digit OTP"
                type="text"
                placeholder="123456"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="otp"
                value={otp()}
                error={otpError()}
                disabled={isLoading()}
                required
                onInput={(value) => {
                  setOtp(value);
                  setOtpError("");
                }}
              />

              <_SubmitButton isLoading={isLoading()}>
                {isLoading() ? (
                  <span class="inline-flex items-center gap-2">
                    <Spinner class="h-4 w-4 text-white/80" />
                    Verifying...
                  </span>
                ) : (
                  "Verify & sign in"
                )}
              </_SubmitButton>
            </form>

            <Show when={error()}>
              <Alert type="error">{error()}</Alert>
            </Show>

            <Show when={status()}>
              <Alert type="success">{status()}</Alert>
            </Show>

            <_RequestNewLink isLoading={isLoading()} onRequest={handleResendOtp} />
            <_BackToLoginLink />
          </div>
        </div>
      </div>
    </_AuthContainer>
  );
};


/*******************************
 *
 * BEGIN page-specific subcomponents below
 *
 *******************************/

const _RequestNewLink: Component<{
  isLoading: boolean;
  onRequest: (e: Event) => void;
}> = (props) => {
  return (
    <div class="text-base text-gray-600 text-center pt-4 border-t border-gray-200">
      Didn&apos;t get an OTP?{" "}
      <Button
        type="button"
        variant="ghost"
        onClick={props.onRequest}
        disabled={props.isLoading}
        class="!h-auto !rounded-none !bg-transparent !px-0 !py-0 !text-base !font-semibold !text-primary-300 hover:!bg-transparent hover:!text-primary"
      >
        Request a new one
      </Button>
    </div>
  );
};

const _BackToLoginLink: Component = () => {
  const navigate = useNavigate();
  return (
    <div class="text-base text-gray-600 text-center pt-2">
      <button
        type="button"
        onClick={() => navigate(-1)}
        class="text-primary-300 hover:text-primary font-semibold"
      >
        Back to Login
      </button>
    </div>
  );
};

export default OtpSignIn;
