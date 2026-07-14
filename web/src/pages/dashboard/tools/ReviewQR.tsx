import { Component, Show, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineExternalLink,
} from "solid-icons/tb";

import {
  PageShell,
  PageHeader,
  PageBody,
  Button,
} from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";

const REVIEW_URL = "https://g.page/r/CYIvaKpIQMa7EAE/review";

const ReviewQR: Component = () => {
  const navigate = useNavigate();
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal("");

  const openReviewPage = () => {
    window.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  };

  const copyReviewLink = async () => {
    setCopyError("");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(REVIEW_URL);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = REVIEW_URL;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError("Unable to copy link.");
    }
  };

  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic component={dashboardOptions.reviewQr.icon} class="h-5 w-5" />
        }
        title={dashboardOptions.reviewQr.title}
        subtitle={dashboardOptions.reviewQr.description}
      />

      <PageBody>
        <div class="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-lg border border-gray-200 bg-white p-5 text-center shadow-sm sm:p-7">
          <div class="w-full max-w-[min(82vw,24rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-inner">
            <img
              src="/images/google-review-qr.svg"
              alt="Google review QR code"
              class="block h-auto w-full"
            />
          </div>

          <div class="space-y-2">
            <h2 class="font-condensed text-3xl font-bold text-gray-900">
              Scan to leave a review
            </h2>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" onClick={copyReviewLink}>
              <Show when={copied()} fallback={<TbOutlineCopy class="h-4 w-4" />}>
                <TbOutlineCheck class="h-4 w-4" />
              </Show>
              {copied() ? "Copied" : "Copy Review Link"}
            </Button>

            <Button variant="primaryOutline" onClick={openReviewPage}>
              <TbOutlineExternalLink class="h-4 w-4" />
              Open Review Page
            </Button>
          </div>

          <Show when={copyError()}>
            <p class="text-sm font-medium text-red-600" role="status">
              {copyError()}
            </p>
          </Show>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default ReviewQR;
