import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildManifest } from "../../chat/citations";
import type { StudySource } from "../../chat/types";
import i18n from "../../i18n";
import { ChatSources } from "./ChatSources";

function source(overrides: Partial<StudySource> = {}): StudySource {
  return {
    id: "S1",
    kind: "bible",
    workId: "web",
    label: "John 3:16 (WEB)",
    canonicalTarget: { kind: "bible", workId: "web", osis: "John", chapter: 3 },
    language: "en",
    excerpt: "16 For God so loved the world.",
    contentVersion: "v1",
    estimatedTokens: 10,
    ...overrides,
  };
}

describe("ChatSources", () => {
  beforeEach(() => i18n.changeLanguage("en"));

  it("renders nothing for an empty manifest", () => {
    const { container } = render(<ChatSources manifest={buildManifest([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact excerpt sent for each source, labelled with its id", () => {
    render(<ChatSources manifest={buildManifest([source()])} />);
    expect(screen.getByText("[S1]")).toBeInTheDocument();
    expect(screen.getByText("John 3:16 (WEB)", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("16 For God so loved the world.")).toBeInTheDocument();
  });

  it("shows the actual model, usage, and content version", () => {
    render(
      <ChatSources
        manifest={buildManifest([source()])}
        actualModel="some/model"
        usage={{ totalTokens: 42 }}
      />,
    );
    expect(screen.getByText(/some\/model/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/v1/)).toBeInTheDocument();
  });

  it("marks a snippet-backed source as a search excerpt, and no other source (M9.4 §3)", () => {
    render(
      <ChatSources
        manifest={buildManifest([
          source(),
          source({ id: "S2", kind: "commentary", label: "MHC — 1Cor 15:12", excerpt: "…rose again…", searchExcerpt: true }),
        ])}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveTextContent("search excerpt");
    expect(items[1]).toHaveTextContent("MHC — 1Cor 15:12 · search excerpt");
  });
});
