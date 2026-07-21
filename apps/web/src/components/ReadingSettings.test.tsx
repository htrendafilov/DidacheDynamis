import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { ReadingSettings } from "./ReadingSettings";

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
});
