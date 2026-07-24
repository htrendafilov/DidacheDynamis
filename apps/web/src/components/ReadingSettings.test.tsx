import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { ReadingSettings } from "./ReadingSettings";
import { TopBar } from "./TopBar";

vi.mock("./DropboxSyncSettings", () => ({
  DropboxSyncSettings: () => <section data-testid="dropbox-settings">Dropbox</section>,
}));

describe("ReadingSettings", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({
      settings: { ...useStore.getState().settings, uiLang: "en", bookMode: "paged" },
    });
  });

  it("places the global book view control above Dropbox and changes the mode", () => {
    render(<ReadingSettings />);
    const bookView = screen.getByRole("group", { name: "Book view" });
    const dropbox = screen.getByTestId("dropbox-settings");

    expect(
      bookView.compareDocumentPosition(dropbox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scrolling" }));
    expect(useStore.getState().settings.bookMode).toBe("scroll");
  });

  it("switches visible application chrome between English and Bulgarian", async () => {
    render(
      <>
        <TopBar onToggleSearch={() => undefined} onToggleSettings={() => undefined} />
        <ReadingSettings />
      </>,
    );
    expect(screen.getByRole("button", { name: "Search" })).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "bg" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Търсене" })).toBeVisible(),
    );
    expect(useStore.getState().settings.uiLang).toBe("bg");
  });
});
