import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "./i18n";
import { useStore } from "./state/store";
import App from "./App";

vi.mock("./components/TopBar", () => ({
  TopBar: ({
    onToggleSearch,
    searchReturnAvailable,
  }: {
    onToggleSearch: () => void;
    searchReturnAvailable?: boolean;
  }) => (
    <button type="button" onClick={onToggleSearch}>
      {searchReturnAvailable ? "Back to results" : "Open search"}
    </button>
  ),
}));

vi.mock("./components/SearchDrawer", () => ({
  SEARCH_DEFAULT_WIDTH: 380,
  SearchDrawer: ({
    open,
    onNavigate,
    onClose,
  }: {
    open: boolean;
    onNavigate?: (kind: "dictionary") => void;
    onClose: () => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onNavigate?.("dictionary");
          onClose();
        }}
      >
        Open dictionary result
      </button>
    ) : null,
}));

vi.mock("./components/UpdateNotice", () => ({ UpdateNotice: () => null }));
vi.mock("./panes/PaneHost", () => ({
  PaneHost: ({ pane }: { pane: { type: string } }) => <div>Active pane: {pane.type}</div>,
}));
vi.mock("./data/hooks", () => ({
  useWorks: () => [
    { id: "web", type: "bible" },
    { id: "easton", type: "dictionary" },
  ],
}));
vi.mock("./sync/dropboxState", () => ({
  installDropboxAutoSync: () => () => undefined,
  useDropboxSync: (
    selector: (state: { initialize: () => Promise<void> }) => () => Promise<void>,
  ) => selector({ initialize: async () => undefined }),
}));

describe("App mobile search navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.history.replaceState(null, "", "/");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    useStore.setState({
      panes: [
        { id: "bible", type: "bible", workId: "web", osis: "John", chapter: 3 },
        { id: "dictionary", type: "dictionary", workId: "easton", osis: "John", chapter: 3 },
      ],
      settings: { ...useStore.getState().settings, uiLang: "en" },
    });
  });

  it("activates the result pane before closing full-screen Search", () => {
    render(<App />);
    expect(screen.getByText("Active pane: bible")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    fireEvent.click(screen.getByRole("button", { name: "Open dictionary result" }));

    expect(screen.getByText("Active pane: dictionary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to results" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
    expect(screen.getByRole("button", { name: "Open dictionary result" })).toBeInTheDocument();
  });

  it("clears a stale Book deep-link hash when its pane is removed", async () => {
    useStore.setState({
      panes: [
        { id: "bible", type: "bible", workId: "web", osis: "John", chapter: 3 },
        {
          id: "book",
          type: "book",
          workId: "baptist1689",
          osis: "John",
          chapter: 3,
          sectionId: "contents",
        },
      ],
    });
    render(<App />);

    await waitFor(() =>
      expect(window.location.hash).toBe("#/book/baptist1689/contents"),
    );
    act(() => useStore.getState().removePane("book"));

    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(useStore.getState().panes).toHaveLength(1);
  });
});
