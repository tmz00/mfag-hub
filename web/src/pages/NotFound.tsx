import { Component } from "solid-js";
import { TbOutlineAlertTriangle } from "solid-icons/tb";

const NotFound: Component = () => {
  return (
    <div class="min-h-dvh bg-linear-to-b from-gray-50 to-primary/5 flex items-center justify-center px-6 py-12">
        <div class="relative p-10 space-y-6 text-center">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-secondary text-white shadow-lg">
            <TbOutlineAlertTriangle class="h-8 w-8" />
          </div>
          <div class="space-y-2">
            <h1 class="text-2xl font-semibold text-primary">
              ERROR 404
            </h1>
            <p class="text-gray-600 max-w-xl mx-auto">
              The page you’re looking for doesn’t exist or may have been moved.
            </p>
          </div>
        </div>
      </div>
  );
};

export default NotFound;
