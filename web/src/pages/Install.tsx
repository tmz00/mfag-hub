import { Component, createSignal, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
  TbOutlineSquarePlus,
  TbOutlineDotsVertical,
  TbOutlineDeviceDesktopDown,
} from "solid-icons/tb";
import { IoShareOutline } from "solid-icons/io";

import packageJson from "../../package.json";

const Install: Component = () => {
  const version = (packageJson as any)?.version;

  const [selectedPlatform, setSelectedPlatform] = createSignal<
    "ios" | "android"
  >("android");
  const [iosDevice, setIosDevice] = createSignal<"iphone" | "ipad" | "ios">(
    "ios",
  );
  const [showSkipInstallLink, setShowSkipInstallLink] = createSignal(false);

  onMount(() => {
    const ua = navigator.userAgent || "";
    const isIPhone = /iPhone/i.test(ua);
    const isIPod = /iPod/i.test(ua);
    const isIPad =
      /iPad/i.test(ua) ||
      (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
    const isIOS = isIPhone || isIPad || isIPod;

    if (isIPhone) {
      setIosDevice("iphone");
    } else if (isIPad) {
      setIosDevice("ipad");
    } else {
      setIosDevice("ios");
    }

    setSelectedPlatform(isIOS ? "ios" : "android");
    setShowSkipInstallLink(isIPad);
  });

  const iosShareButtonLocation = () => {
    if (iosDevice() === "iphone") return "bottom";
    if (iosDevice() === "ipad") return "top-right";
    return "bottom or top-right";
  };
  const switchPlatform = () =>
    setSelectedPlatform(selectedPlatform() === "ios" ? "android" : "ios");

  return (
    <div class="min-h-dvh w-full bg-linear-to-br from-primary-50 via-white to-secondary-50 flex items-center justify-center p-8">
      <div class="w-full max-w-lg">
        {/* Logo */}
        <div class="items-center flex flex-col gap-3 mb-6">
          <a href="https://mfag.sg">
            <img
              src="/images/hub_banner.png"
              alt="MFAG Hub Banner"
              class="w-100 cursor-pointer"
            />
          </a>
          <span class="text-base text-gray-700">Version {version}</span>
        </div>

        {/* Install Instructions */}
        <div class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div class="bg-linear-to-r from-primary-500 to-primary-500 via-primary-400 px-4 py-4 text-center">
            <div class="flex items-center justify-center gap-2">
              <img
                src={
                  selectedPlatform() === "ios"
                    ? "/images/install/apple.png"
                    : "/images/install/android.png"
                }
                alt=""
                class="h-7 w-7 object-contain"
              />
              <h2 class="text-2xl font-semibold text-white">Installation</h2>
            </div>
          </div>

          <div>
            <Show when={selectedPlatform() === "ios"}>
              <div class="p-4 space-y-4">
                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    1
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Ensure you are viewing this site in <strong>Safari</strong>
                    <br />
                    <i class="text-base text-gray-600">(not in Private mode)</i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    2
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap the{" "}
                    <strong>
                      <IoShareOutline class="h-4 w-4 inline mx-0.5" />
                      Share button{" "}
                    </strong>
                    <br />
                    <i class="text-base text-gray-600">
                      ({iosShareButtonLocation()})
                    </i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    3
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap{" "}
                    <strong>
                      Add to Home Screen{" "}
                      <TbOutlineSquarePlus class="h-4 w-4 text-gray-700 inline mx-0.5" />
                    </strong>
                    <br />
                    <i class="text-base text-gray-600">(in the popup menu)</i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    4
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap <strong>Add</strong> to confirm
                  </div>
                </div>
              </div>
            </Show>

            <Show when={selectedPlatform() === "android"}>
              <div class="p-4 space-y-4">
                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    1
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Ensure you are viewing this site in <strong>Chrome</strong>
                    <br />
                    <i class="text-base text-gray-600">
                      (not in Incognito mode)
                    </i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    2
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap the{" "}
                    <strong>
                      <TbOutlineDotsVertical class="h-4 w-4 text-gray-700 inline mx-0.5" />
                      button
                    </strong>
                    <br />
                    <i class="text-base text-gray-600">(top-right)</i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    3
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap{" "}
                    <strong>
                      <TbOutlineDeviceDesktopDown class="h-4 w-4 text-gray-700 inline mx-0.5" />{" "}
                      Add to Home screen
                    </strong>
                    <br />
                    <i class="text-base text-gray-600">(in the popup menu)</i>
                  </div>
                </div>

                <div class="flex gap-3 items-start">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white flex-shrink-0">
                    4
                  </div>
                  <div class="text-base text-gray-800 pt-0.5">
                    Tap <strong>Install</strong> to confirm
                  </div>
                </div>
              </div>
            </Show>
          </div>

          <div class="px-4 pb-4 text-center">
            <button
              type="button"
              onClick={switchPlatform}
              class="cursor-pointer text-sm font-medium text-primary hover:text-secondary hover:underline"
            >
              <Show
                when={selectedPlatform() === "android"}
                fallback="View Android steps"
              >
                View iPhone / iPad steps
              </Show>
            </button>
          </div>
        </div>

        <Show when={showSkipInstallLink()}>
          <div class="mt-10 text-center">
            <A
              href="/login"
              class="text-sm font-medium text-primary hover:text-secondary hover:underline"
            >
              Skip install and continue to login &rarr;
            </A>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default Install;
