import { beforeEach, describe, expect, it } from "vitest";

import { useStore, type Pane } from "./store";

const biblePane = (id: string, osis: string, chapter: number): Pane => ({
  id,
  type: "bible",
  workId: "web",
  osis,
  chapter,
});

describe("store", () => {
  beforeEach(() => {
    useStore.setState({ panes: [biblePane("a", "John", 3)] });
  });

  it("adds panes up to a maximum of 3", () => {
    const { addPane } = useStore.getState();
    addPane();
    addPane();
    addPane();
    expect(useStore.getState().panes).toHaveLength(3);
  });

  it("never removes the last pane", () => {
    useStore.getState().removePane("a");
    expect(useStore.getState().panes).toHaveLength(1);
  });

  it("syncs the passage across all bible panes when sync is on", () => {
    useStore.setState({
      panes: [biblePane("a", "John", 3), biblePane("b", "John", 3)],
      settings: { ...useStore.getState().settings, sync: true },
    });
    useStore.getState().goToRef("Ps", 23, "a");
    expect(useStore.getState().panes.every((p) => p.osis === "Ps" && p.chapter === 23)).toBe(true);
  });

  it("moves only the originating pane when sync is off", () => {
    useStore.setState({
      panes: [biblePane("a", "John", 3), biblePane("b", "Gen", 1)],
      settings: { ...useStore.getState().settings, sync: false },
    });
    useStore.getState().goToRef("Ps", 23, "a");
    const panes = useStore.getState().panes;
    expect(panes.find((p) => p.id === "a")).toMatchObject({ osis: "Ps", chapter: 23 });
    expect(panes.find((p) => p.id === "b")).toMatchObject({ osis: "Gen", chapter: 1 });
  });
});
