import { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import EditProfile from "../dashboard/settings/EditProfile";

const CompleteProfile: Component = () => {
  const navigate = useNavigate();

  const handleSaveSuccess = () => {
    navigate("/", { replace: true });
  };

  return <EditProfile forceComplete onSaveSuccess={handleSaveSuccess} />;
};

export default CompleteProfile;
