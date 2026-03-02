export const hasSharedToolQuery = (keys: readonly string[]): boolean => {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  return keys.some((key) => params.has(key));
};
