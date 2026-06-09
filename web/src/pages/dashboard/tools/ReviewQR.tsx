import { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlineExternalLink } from "solid-icons/tb";

import { PageShell, PageHeader, PageBody, Button } from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";

const REVIEW_URL = "https://g.page/r/CYIvaKpIQMa7EAE/review";

const ReviewQR: Component = () => {
  const navigate = useNavigate();

  const openReviewPage = () => {
    window.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic
            component={dashboardOptions.reviewQr.icon}
            class="h-5 w-5"
          />
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
            <p class="text-base text-gray-600">
              Ask the client to scan this QR code with their mobile device.
            </p>
          </div>

          <Button variant="primaryOutline" onClick={openReviewPage}>
            <TbOutlineExternalLink class="h-4 w-4" />
            Open Review Page
          </Button>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default ReviewQR;
