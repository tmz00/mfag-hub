import { Component } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import HandbookSearchModal from "./HandbookSearchModal";

const HandbookSearch: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialCategory = () =>
    (Array.isArray(searchParams.category)
      ? searchParams.category[0]
      : searchParams.category || ""
    ).trim();
  const replaceResultNavigation = () => {
    const value = Array.isArray(searchParams.replace)
      ? searchParams.replace[0]
      : searchParams.replace || "";
    return value === "1";
  };
  const returnTo = () => {
    const value = Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo || "";
    return value.startsWith("/") ? value : "";
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
