import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildManifest } from "../../chat/citations";
import type { StudySource } from "../../chat/types";
import "../../i18n";
import { ChatMessage } from "./ChatMessage";

function source(overrides: Partial<StudySource> = {}): StudySource {
  return {
    id: "S1",
    kind: "bible",
    workId: "web",
    label: "John 3:16 (WEB)",
    canonicalTarget: { kind: "bible", workId: "web", osis: "John", chapter: 3, verse: 16 },
    language: "en",
    excerpt: "16 For God so loved the world.",
    contentVersion: "v1",
    estimatedTokens: 10,
    ...overrides,
  };
}

describe("ChatMessage", () => {
  it("renders a resolved citation as a clickable button that reports the source on click", () => {
    const manifest = buildManifest([source()]);
    const onCitationClick = vi.fn();
    render(<ChatMessage text="See [S1]." manifest={manifest} onCitationClick={onCitationClick} />);
    const button = screen.getByRole("button", { name: /John 3:16/ });
    expect(button).toHaveTextContent("[S1]");
    fireEvent.click(button);
    expect(onCitationClick).toHaveBeenCalledWith(source());
  });

  it("renders an unresolved citation as inert text, never a button", () => {
    const manifest = buildManifest([source({ id: "S1" }), source({ id: "S2" }), source({ id: "S3" })]);
    render(<ChatMessage text="Fabricated [S9]." manifest={manifest} onCitationClick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("[S9]")).toBeInTheDocument();
  });

  it("renders a malformed citation attempt as inert text too", () => {
    const manifest = buildManifest([source()]);
    render(<ChatMessage text="Bad [S1,S2] marker." manifest={manifest} onCitationClick={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders bold, italic, and inline code", () => {
    const { container } = render(
      <ChatMessage text="a **b** c *d* e `f`" manifest={buildManifest([])} onCitationClick={vi.fn()} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("d");
    expect(container.querySelector("code")?.textContent).toBe("f");
  });

  it("renders a list", () => {
    render(<ChatMessage text={"- one\n- two"} manifest={buildManifest([])} onCitationClick={vi.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never emits a raw HTML element or a real anchor from message text", () => {
    const text = '<img src=x onerror=alert(1)> <a href="javascript:alert(1)">click</a>';
    const { container } = render(
      <ChatMessage text={text} manifest={buildManifest([])} onCitationClick={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("onerror=alert(1)");
  });

  it("never turns a raw URL into a link", () => {
    const { container } = render(
      <ChatMessage
        text="See http://evil.example/x for details."
        manifest={buildManifest([])}
        onCitationClick={vi.fn()}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("http://evil.example/x");
  });
});
