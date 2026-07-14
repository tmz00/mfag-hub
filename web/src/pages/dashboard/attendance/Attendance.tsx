import {
  Component,
  For,
  Show,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import jsQR from "jsqr";
import {
  TbOutlineCalendarCheck,
  TbOutlineCamera,
  TbOutlineRefresh,
} from "solid-icons/tb";

import { Button, LoadingState, PageBody, PageHeader, PageShell } from "../../../components/ui";
import { attendanceService } from "../../../services/attendanceService";

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

const getBarcodeDetector = (): BarcodeDetectorCtor | null => {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector || null;
};

const hasCameraAccess = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const extractToken = (raw: string) => {
  const value = raw.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.searchParams.get("token") || value;
  } catch {
    return value;
  }
};

const statusClass = (status: string) => {
  switch (status) {
    case "present":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "late":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "excused":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    default:
      return "bg-gray-100 text-gray-600 ring-gray-200";
  }
};

const Attendance: Component = () => {
  const navigate = useNavigate();
  const [history, { refetch }] = createResource(() =>
    attendanceService.getMyHistory(),
  );
  const [checkingIn, setCheckingIn] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [scanning, setScanning] = createSignal(false);
  const [scanSupported] = createSignal(hasCameraAccess());
  let videoRef: HTMLVideoElement | undefined;
  let stream: MediaStream | null = null;
  let scanTimer: number | undefined;
  let cameraFrameTimer: number | undefined;
  let detecting = false;

  const waitForVideoElement = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (videoRef) return videoRef;
      await Promise.resolve();
    }
    return videoRef;
  };

  const stopScan = () => {
    setScanning(false);
    if (scanTimer) {
      window.clearInterval(scanTimer);
      scanTimer = undefined;
    }
    if (cameraFrameTimer) {
      window.clearTimeout(cameraFrameTimer);
      cameraFrameTimer = undefined;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  };

  onCleanup(stopScan);

  onMount(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) void checkIn(token);
  });

  const checkIn = async (raw: string) => {
    const token = extractToken(raw);
    if (!token) {
      setError("Scan an attendance QR code.");
      return;
    }

    setCheckingIn(true);
    setError("");
    setMessage("");
    try {
      const result = await attendanceService.checkIn(token);
      setMessage(
        result.duplicate
          ? `Already checked in for ${result.meeting.title}.`
          : `Attendance recorded for ${result.meeting.title}.`,
      );
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check in");
    } finally {
      setCheckingIn(false);
    }
  };

  const startScan = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera scanning is not available. Open this page on HTTPS and allow camera access, or scan the QR with your phone camera.");
      return;
    }

    setError("");
    setMessage("");
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      const Detector = getBarcodeDetector();
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      setScanning(true);
      const video = await waitForVideoElement();
      if (!video) {
        throw new Error("Unable to show camera preview. Please close and reopen Attendance.");
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      await video.play();
      cameraFrameTimer = window.setTimeout(() => {
        if (!scanning()) return;
        if (video.videoWidth && video.videoHeight) return;
        setError("Camera permission was granted, but no video preview started. Close the scanner and try again.");
      }, 2500);
      scanTimer = window.setInterval(async () => {
        if (!videoRef || !context || checkingIn() || detecting) return;
        if (videoRef.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        if (!videoRef.videoWidth || !videoRef.videoHeight) return;
        detecting = true;
        try {
          canvas.width = videoRef.videoWidth;
          canvas.height = videoRef.videoHeight;
          context.drawImage(videoRef, 0, 0, canvas.width, canvas.height);

          let raw = "";
          if (detector) {
            try {
              const codes = await detector.detect(canvas);
              raw = codes[0]?.rawValue || "";
            } catch {
              raw = "";
            }
          }
          if (!raw && typeof context.getImageData === "function") {
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            raw = jsQR(imageData.data, imageData.width, imageData.height)?.data || "";
          }
          if (raw) {
            stopScan();
            await checkIn(raw);
          }
        } finally {
          detecting = false;
        }
      }, 500);
    } catch (err) {
      stopScan();
      setError(err instanceof Error ? err.message : "Unable to start camera");
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="dashboard"
        onBack={() => navigate("/")}
        icon={<TbOutlineCalendarCheck class="h-5 w-5" />}
        title="Attendance"
        subtitle="Scan meeting QR and view your records"
      />
      <PageBody>
        <div class="mx-auto max-w-3xl space-y-4">
          <section class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Check In</h2>
                <p class="text-sm text-gray-500">Scan the QR shown during the meeting.</p>
              </div>
              <Show when={scanSupported()}>
                <Button
                  type="button"
                  variant={scanning() ? "secondary" : "primary"}
                  onClick={() => (scanning() ? stopScan() : void startScan())}
                >
                  <TbOutlineCamera class="h-5 w-5" />
                  {scanning() ? "Stop Camera" : "Scan QR"}
                </Button>
              </Show>
            </div>

            <div class={scanning() ? "fixed inset-0 z-50 flex flex-col bg-black md:static md:mt-4 md:overflow-hidden md:rounded-lg" : "hidden"}>
                <div class="flex items-center justify-between gap-3 bg-black/80 px-4 py-3 text-white md:hidden">
                  <div class="font-semibold">Scan Attendance QR</div>
                  <button
                    type="button"
                    onClick={stopScan}
                    class="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-semibold"
                  >
                    Close
                  </button>
                </div>
                <video
                  ref={videoRef}
                  autoplay
                  playsinline
                  muted
                  class="min-h-0 flex-1 object-cover md:aspect-video md:w-full"
                />
                <div class="bg-black/80 px-4 py-3 text-center text-sm text-white md:hidden">
                  Point the camera at the meeting QR code.
                </div>
            </div>

            <Show when={!scanSupported()}>
              <div class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                Camera scanning is unavailable here. Open this page on HTTPS and allow camera access, or scan the QR with your phone camera.
              </div>
            </Show>
          </section>

          <Show when={message()}>
            <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-base text-emerald-700">{message()}</div>
          </Show>
          <Show when={error()}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">{error()}</div>
          </Show>

          <section class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-900">My Attendance</h2>
              <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()}>
                <TbOutlineRefresh class="h-4 w-4" />
                Refresh
              </Button>
            </div>
            <Show when={!history.loading} fallback={<LoadingState label="Loading attendance..." />}>
              <Show when={(history() || []).length > 0} fallback={<div class="rounded-lg bg-gray-50 p-4 text-gray-500">No attendance records yet.</div>}>
                <div class="space-y-2">
                  <For each={history() || []}>
                    {(record) => (
                      <div class="rounded-lg border border-gray-200 p-3">
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div class="font-semibold text-gray-900">{record.meeting.title}</div>
                            <div class="text-sm text-gray-500">{formatDateTime(record.meeting.startsAt)}</div>
                          </div>
                          <span class={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(record.status)}`}>
                            {record.status}
                          </span>
                        </div>
                        <Show when={record.checkedInAt}>
                          <div class="mt-2 text-sm text-gray-600">Checked in: {formatDateTime(record.checkedInAt)}</div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default Attendance;
