import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import i18n from "../i18n";
import { useDropboxSync } from "../sync/dropboxState";
import { DropboxSyncSettings } from "./DropboxSyncSettings";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useDropboxSync.setState({
    configured: false,
    connected: false,
    phase: "idle",
    error: null,
    lastSyncAt: null,
    conflicts: 0,
  });
});

describe("DropboxSyncSettings", () => {
  it("explains when the deployment has no Dropbox app key", () => {
    render(<DropboxSyncSettings />);
    expect(screen.getByRole("heading", { name: "Dropbox notes sync" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not configured");
  });

  it("shows explicit conflict guidance while connected", () => {
    useDropboxSync.setState({ configured: true, connected: true, conflicts: 2 });
    render(<DropboxSyncSettings />);
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 conflicts");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
