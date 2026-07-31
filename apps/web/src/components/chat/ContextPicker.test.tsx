import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneralBook, Passage, Work } from "../../data/api";
import { db } from "../../data/notes";
import i18n from "../../i18n";
import type { Pane } from "../../state/store";
import { ContextPicker, summarizeContext } from "./ContextPicker";

let works: Work[] = [];
let passageByPane: Record<string, Passage | undefined> = {};
let generalBookByWork: Record<string, GeneralBook | undefined> = {};

vi.mock("../../data/hooks", () => ({
  useWorks: () => works,
  usePassage: (workId: string, osis: string, chapter: number) => ({
    workId,
    osis,
    chapter,
    loading: false,
    error: false,
    data: passageByPane[`${workId}:${osis}:${chapter}`] ?? null,
  }),
  useGeneralBook: (workId: string) => ({
    loading: false,
    error: false,
    data: generalBookByWork[workId] ?? null,
  }),
}));

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id,
    type: "bible",
    language: "en",
    title: id,
    abbrev: id.toUpperCase(),
    direction: "ltr",
    versification: "kjv",
    license: "Public Domain",
    attribution: "",
    source_url: null,
    source_version: null,
    ai_context_policy: "allowed",
    ...overrides,
  };
}

function pane(overrides: Partial<Pane> & { type: Pane["type"]; workId: string }): Pane {
  return { id: `pane-${Math.random()}`, osis: "John", chapter: 3, ...overrides };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  works = [work("web"), work("mhc", { type: "commentary" }), work("easton", { type: "dictionary" })];
  passageByPane = {};
  generalBookByWork = {};
  await db.notes.clear();
});

describe("ContextPicker", () => {
  it("defaults on the first bible pane and the first commentary pane only", async () => {
    const panes: Pane[] = [
      pane({ type: "bible", workId: "web", osis: "John", chapter: 3 }),
      pane({ type: "bible", workId: "web", osis: "Ps", chapter: 23 }),
      pane({ type: "commentary", workId: "mhc", osis: "John", chapter: 3 }),
    ];
    const onChipsChange = vi.fn();
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />);
    await waitFor(() => expect(onChipsChange).toHaveBeenCalled());
    const calls = onChipsChange.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall).toEqual([
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: undefined },
      { kind: "commentary", workId: "mhc", osis: "John", chapter: 3 },
    ]);
  });

  it("emits an updated chip set when a chip is toggled off", async () => {
    const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
    const onChipsChange = vi.fn();
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />);
    const checkbox = await screen.findByRole("checkbox", { name: /John 3/ });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
  });

  it("renders a licence-blocked chip disabled, with an actionable reason, and never includes it when emitting", async () => {
    works = [work("web", { ai_context_policy: "prohibited" })];
    const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
    const onChipsChange = vi.fn();
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />);
    const checkbox = await screen.findByRole("checkbox", { name: /John 3/ });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/does not allow AI use/)).toBeInTheDocument();
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
  });

  it("shows Strong's chips for the selected verse's distinct lemma ids", async () => {
    const panes: Pane[] = [
      pane({ type: "bible", workId: "web", osis: "John", chapter: 3, selectedVerse: 16 }),
    ];
    passageByPane["web:John:3"] = {
      work_id: "web",
      osis: "John",
      chapter: 3,
      headings: [],
      verses: [
        {
          verse: 16,
          lines: [
            {
              kind: "p",
              level: 1,
              para_start: true,
              runs: [
                { t: "only begotten", lemma: [{ id: "G3439" }] },
                { t: " ", lemma: undefined },
                { t: "loved", lemma: [{ id: "G0025" }] },
              ],
            },
          ],
        },
      ],
    };
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={vi.fn()} />);
    expect(await screen.findByText(/G3439/)).toBeInTheDocument();
    expect(screen.getByText(/G0025/)).toBeInTheDocument();
  });

  it("offers a cross-references chip for the selected verse, off by default, and includes it when toggled on", async () => {
    const panes: Pane[] = [
      pane({ type: "bible", workId: "web", osis: "John", chapter: 3, selectedVerse: 16 }),
    ];
    const onChipsChange = vi.fn();
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />);
    const checkbox = await screen.findByRole("checkbox", { name: /Cross-references.*John 3:16/ });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          { kind: "xref", osis: "John", chapter: 3, verse: 16, previewWork: "web" },
        ]),
      ),
    );
  });

  it("disables the xref chip when the TSK-type work is blocked, even though the preview work is allowed", async () => {
    // context.ts's real builder requires both the TSK cross-reference work and the
    // preview work to be eligible (§4 step 2 in context.ts) — the picker must agree, or a
    // chip can render enabled and then get silently dropped during buildContext.
    works = [work("web"), work("tsk", { type: "xref", ai_context_policy: "prohibited" })];
    const panes: Pane[] = [
      pane({ type: "bible", workId: "web", osis: "John", chapter: 3, selectedVerse: 16 }),
    ];
    const onChipsChange = vi.fn();
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />);
    const checkbox = await screen.findByRole("checkbox", { name: /Cross-references.*John 3:16/ });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/does not allow AI use/)).toBeInTheDocument();
  });

  it("shows a note chip for the current chapter with a personal-data warning, off by default", async () => {
    await db.notes.put({
      id: "note-1",
      kind: "passage",
      title: "My thoughts",
      contentHtml: "<p>x</p>",
      osis: "John",
      chapter: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
    render(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={vi.fn()} />);
    const noteCheckbox = await screen.findByRole("checkbox", { name: "My thoughts" });
    expect(noteCheckbox).not.toBeChecked();
    expect(screen.getByText(/personal information/)).toBeInTheDocument();
  });

  it("retroactively drops an already-selected allowed_no_training source when privacy routing turns off (§11)", async () => {
    const { setLoggingConfirmed } = await import("../../chat/credentials");
    setLoggingConfirmed(true);
    works = [work("web", { ai_context_policy: "allowed_no_training" })];
    const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={true} onChipsChange={onChipsChange} />,
    );
    // Eligible and default-selected: privacyRouting is on and logging is confirmed.
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: undefined },
      ]),
    );
    // Turning privacy routing off must drop it, visibly, without the user touching the
    // checkbox — this is the exact failure §11 exists to prevent.
    rerender(<ContextPicker panes={panes} privacyRouting={false} loggingConfirmed={true} onChipsChange={onChipsChange} />);
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
    expect(screen.getByText(/turn on privacy routing/i)).toBeInTheDocument();
    setLoggingConfirmed(false);
  });

  it("re-emits when loggingConfirmed changes on its own, privacyRouting untouched — the emission effect must not miss this dependency", async () => {
    const { setLoggingConfirmed } = await import("../../chat/credentials");
    setLoggingConfirmed(false);
    works = [work("web", { ai_context_policy: "allowed_no_training" })];
    const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    // Blocked: privacy routing is on, but logging is not confirmed yet.
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
    expect(screen.getByText(/confirm OpenRouter logging/i)).toBeInTheDocument();

    // Confirm logging (mirrors what ChatSettings' checkbox does: write to sessionStorage
    // and update the loggingConfirmed prop in the same event) — privacyRouting is
    // unchanged, so only loggingConfirmed distinguishes this render from the last.
    setLoggingConfirmed(true);
    rerender(<ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={true} onChipsChange={onChipsChange} />);

    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: undefined },
      ]),
    );
    setLoggingConfirmed(false);
  });

  // The default-on seeding runs once and must, or later pane navigation would resurrect
  // chips the reader deliberately turned off. That made chip identity load-bearing: keying
  // a pane chip by the reference it happened to show meant every chapter turn minted a new
  // key that nothing re-armed, so the picker went silently empty and every question after
  // the reader's first chapter turn was answered with no context at all.
  it("keeps a checked pane chip checked when the pane navigates to another chapter", async () => {
    const paneId = "pane-bible-1";
    const at = (chapter: number): Pane => ({ id: paneId, type: "bible", workId: "web", osis: "John", chapter });
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={[at(3)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: undefined },
      ]),
    );

    rerender(
      <ContextPicker panes={[at(4)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 4, verses: undefined },
      ]),
    );
  });

  it("follows the pane when the reader switches bible version too", async () => {
    const paneId = "pane-bible-1";
    const at = (workId: string): Pane => ({ id: paneId, type: "bible", workId, osis: "John", chapter: 3 });
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={[at("web")]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([expect.objectContaining({ workId: "web" })]));

    works = [...works, work("bg1940")];
    rerender(
      <ContextPicker panes={[at("bg1940")]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([expect.objectContaining({ workId: "bg1940" })]),
    );
  });

  it("does not carry a typed verse range across a chapter change", async () => {
    const paneId = "pane-bible-1";
    const at = (chapter: number): Pane => ({ id: paneId, type: "bible", workId: "web", osis: "John", chapter });
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={[at(3)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() => expect(onChipsChange).toHaveBeenCalled());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "16-18" } });
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16-18" },
      ]),
    );

    // "16-18" was typed about John 3. John 4 must not silently inherit it.
    rerender(
      <ContextPicker panes={[at(4)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() =>
      expect(onChipsChange).toHaveBeenLastCalledWith([
        { kind: "bible", workId: "web", osis: "John", chapter: 4, verses: undefined },
      ]),
    );
  });

  it("still does not re-check a chip the reader turned off, after navigation", async () => {
    const paneId = "pane-bible-1";
    const at = (chapter: number): Pane => ({ id: paneId, type: "bible", workId: "web", osis: "John", chapter });
    const onChipsChange = vi.fn();
    const { rerender } = render(
      <ContextPicker panes={[at(3)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() => expect(onChipsChange).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole("checkbox")[0]); // turn it off
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));

    rerender(
      <ContextPicker panes={[at(4)]} privacyRouting={true} loggingConfirmed={false} onChipsChange={onChipsChange} />,
    );
    await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
  });
});

  // The collapsed strip is the default state, so its one-line summary is the only
  // description of scope the reader sees before sending. It is derived from the same
  // eligible collection as the emitted chips; computing the two separately let the summary
  // claim sources that were never going to be sent.
  describe("collapsed strip summary", () => {
    it("says nothing is selected when the licence gate refuses everything picked", async () => {
      works = [work("web", { ai_context_policy: "allowed_no_training" })];
      const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
      const onChipsChange = vi.fn();
      render(
        <ContextPicker panes={panes} privacyRouting={false} loggingConfirmed={false} onChipsChange={onChipsChange} />,
      );
      await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
      expect(screen.getByText(/Context ·/)).toHaveTextContent(/nothing selected/i);
      // The blocked chip itself stays listed inside the expanded strip, disabled and with
      // its reason (§11 — a licence block is shown, not silently omitted). It is only the
      // summary line, which describes what is being sent, that must not claim it.
      expect(screen.getByRole("checkbox", { name: /John 3/ })).toBeDisabled();
    });

    it("names the source again once privacy routing makes it eligible", async () => {
      const { setLoggingConfirmed } = await import("../../chat/credentials");
      setLoggingConfirmed(true);
      works = [work("web", { ai_context_policy: "allowed_no_training" })];
      const panes: Pane[] = [pane({ type: "bible", workId: "web", osis: "John", chapter: 3 })];
      const onChipsChange = vi.fn();
      const { rerender } = render(
        <ContextPicker panes={panes} privacyRouting={false} loggingConfirmed={true} onChipsChange={onChipsChange} />,
      );
      await waitFor(() => expect(onChipsChange).toHaveBeenLastCalledWith([]));
      expect(screen.getByText(/Context ·/)).toHaveTextContent(/nothing selected/i);

      rerender(
        <ContextPicker panes={panes} privacyRouting={true} loggingConfirmed={true} onChipsChange={onChipsChange} />,
      );
      await waitFor(() => expect(onChipsChange.mock.calls[onChipsChange.mock.calls.length - 1][0]).toHaveLength(1));
      expect(screen.getByText(/Context ·/)).toHaveTextContent(/John 3 \(WEB\)/);
      setLoggingConfirmed(false);
    });

    it("does not count a chip whose pane has been closed", async () => {
      const bible: Pane = { id: "p1", type: "bible", workId: "web", osis: "John", chapter: 3 };
      const dict: Pane = {
        id: "p2",
        type: "dictionary",
        workId: "easton",
        osis: "John",
        chapter: 3,
        headword: "Grace",
      };
      const onChipsChange = vi.fn();
      const { rerender } = render(
        <ContextPicker
          panes={[bible, dict]}
          privacyRouting={true}
          loggingConfirmed={false}
          onChipsChange={onChipsChange}
        />,
      );
      await waitFor(() => expect(onChipsChange).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("checkbox", { name: /Grace/ }));
      await waitFor(() => expect(onChipsChange.mock.calls[onChipsChange.mock.calls.length - 1][0]).toHaveLength(2));

      // The dictionary pane closes; its key lingers in `enabled` but nothing sends it.
      rerender(
        <ContextPicker
          panes={[bible]}
          privacyRouting={true}
          loggingConfirmed={false}
          onChipsChange={onChipsChange}
        />,
      );
      await waitFor(() => expect(onChipsChange.mock.calls[onChipsChange.mock.calls.length - 1][0]).toHaveLength(1));
      expect(screen.getByText(/Context ·/).textContent).not.toMatch(/\+\d/);
    });
  });

describe("summarizeContext", () => {
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts ?? {});
  const source = (label: string, estimatedTokens: number) => ({ label, estimatedTokens });

  it("lists the sources and their token total", () => {
    const summary = summarizeContext([source("John 3:16 (WEB)", 40), source("MHC — John 3", 900)], [], t);
    expect(summary).toContain("John 3:16 (WEB), MHC — John 3");
    expect(summary).toContain("940");
  });

  it("names why each source was dropped instead of only counting them", () => {
    const summary = summarizeContext(
      [source("John 3:16 (WEB)", 40)],
      [
        { label: "1689 Confession", kind: "book", reason: "over-cap" },
        { label: "Easton: Grace", kind: "dictionary", reason: "duplicate" },
      ],
      t,
    );
    expect(summary).toMatch(/too large to send whole/i);
    expect(summary).toContain("1689 Confession");
    expect(summary).toMatch(/duplicate/i);
    expect(summary).toContain("Easton: Grace");
  });

  // §11: a licence block must be readable, not a silent omission. Reporting "No context
  // selected" for a turn where the gate blocked everything tells the reader they picked
  // nothing, when in fact they picked several works and none were allowed to leave.
  it("reports licence blocks even when nothing survived, with the actionable reason", () => {
    const summary = summarizeContext(
      [],
      [
        { label: "MHC — John 3", kind: "commentary", reason: "licence", detail: "turnOnPrivacyRouting" },
      ],
      t,
    );
    expect(summary).toMatch(/blocked by (its|their) licence/i);
    expect(summary).toContain("MHC — John 3");
    expect(summary).toContain(i18n.t("chat.licence.turnOnPrivacyRouting"));
  });

  it("reports dropped conversation turns", () => {
    const summary = summarizeContext([source("John 3:16 (WEB)", 40)], [], t, 3);
    expect(summary).toMatch(/3 earlier turns/i);
  });

  it("uses singular and plural forms correctly", () => {
    const one = summarizeContext([], [{ label: "A", kind: "book", reason: "duplicate" }], t);
    const many = summarizeContext(
      [],
      [
        { label: "A", kind: "book", reason: "duplicate" },
        { label: "B", kind: "book", reason: "duplicate" },
      ],
      t,
    );
    expect(one).toMatch(/1 duplicate source was removed/i);
    expect(many).toMatch(/2 duplicate sources were removed/i);
  });
});
