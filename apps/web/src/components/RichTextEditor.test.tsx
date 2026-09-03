import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { RichTextEditor } from "./RichTextEditor";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(noteId: string, initialHtml: string) {
  const onChange = vi.fn();
  const props = { onChange, onCommit: vi.fn(), onError: vi.fn() };
  const view = render(<RichTextEditor noteId={noteId} initialHtml={initialHtml} {...props} />);
  const rerender = (id: string, html: string) =>
    view.rerender(<RichTextEditor noteId={id} initialHtml={html} {...props} />);
  return { onChange, rerender };
}

describe("RichTextEditor", () => {
  // setContent's emitUpdate:false is what keeps loading a note from looking like typing in it.
  it("does not report a change when a note is loaded, or when switching notes", async () => {
    const { onChange, rerender } = setup("n1", "<p>first note</p>");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("first note"));
    expect(onChange).not.toHaveBeenCalled();

    rerender("n2", "<p>second note</p>");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("second note"));
    expect(onChange).not.toHaveBeenCalled();
  });

  // Without this the test above would also pass with onChange never wired up at all.
  it("reports a change when the user edits", async () => {
    const { onChange } = setup("n1", "<p>first note</p>");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("first note"));

    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0]).toContain("<h2>");
  });
});
