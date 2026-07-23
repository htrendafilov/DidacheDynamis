import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { UpdateNotice } from "./UpdateNotice";

function versionResponse(buildId: string): Response {
  return {
    ok: true,
    json: async () => ({ buildId }),
  } as Response;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpdateNotice", () => {
  it("stays hidden when the deployed build matches the running app", async () => {
    const fetchMock = vi.fn().mockResolvedValue(versionResponse(__APP_BUILD_ID__));
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdateNotice />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers a user-controlled reload when a newer build is deployed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(versionResponse(`${__APP_BUILD_ID__}-new`)),
    );
    const onReload = vi.fn();

    render(<UpdateNotice onReload={onReload} />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "A new version is available.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("does not interrupt reading when the version check fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    render(<UpdateNotice />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
