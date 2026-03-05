import { Component } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import HandbookSearchModal from "./HandbookSearchModal";

const HandbookSearch: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const readSearchParam = (key: string): string => {
    if (typeof window !== "undefined") {
      const direct = new URLSearchParams(window.location.search).get(key);
      if (typeof direct === "string") {
        return direct.trim();
      }
    }

    const value = (searchParams as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return String(value[0] || "").trim();
    }

    return String(value || "").trim();
  };
  const initialCategory = () =>
    readSearchParam("category");
  const replaceResultNavigation = () => {
    return readSearchParam("replace") === "1";
  };
  const returnTo = () => {
    const value = readSearchParam("returnTo");
    if (!value.startsWith("/") || value.startsWith("//")) {
      return "";
    }

    return value;
  };

  const handleClose = () => {
    if (returnTo()) {
      navigate(returnTo(), { replace: true });
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <HandbookSearchModal
      onClose={handleClose}
      closeOnResultClick={false}
      renderAsPage
      initialCategory={initialCategory()}
      replaceResultNavigation={replaceResultNavigation()}
    />
  );
};

export default HandbookSearch;
