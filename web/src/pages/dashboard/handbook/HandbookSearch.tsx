import { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import HandbookSearchModal from "./HandbookSearchModal";

const HandbookSearch: Component = () => {
  const navigate = useNavigate();

  const handleClose = () => {
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
    />
  );
};

export default HandbookSearch;
