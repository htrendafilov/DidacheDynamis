import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { ReadingSettings } from "./ReadingSettings";

const works = vi.hoisted(() => ({ value: [] as { id: string; type: string }[] }));
vi.mock("../data/hooks", () => ({
  useWorks: () => works.value,
}));
vi.mock("./DropboxSyncSettings", () => ({
  DropboxSyncSettings: () => <section data-testid="dropbox-settings">Dropbox</section>,
}));

describe("ReadingSettings Strong's control", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({
      settings: { ...useStore.getState().settings, uiLang: "en", strongs: "off" },
    });
  });

  it("is hidden when no lexicon work is installed", () => {
    works.value = [{ id: "easton", type: "dictionary" }];
    render(<ReadingSettings />);
    expect(screen.queryByRole("group", { name: "Strong's numbers" })).not.toBeInTheDocument();
  });

  it("toggles Strong's word lookup when a lexicon work is installed", () => {
    works.value = [
      { id: "easton", type: "dictionary" },
      { id: "strongsgreek", type: "lexicon" },
    ];
    render(<ReadingSettings />);

    const group = screen.getByRole("group", { name: "Strong's numbers" });
    expect(group).toBeVisible();
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "On" }));
    expect(useStore.getState().settings.strongs).toBe("on");
  });
});
