import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  buildManifest,
  navigationIntent,
  stripCitationMarkers,
  type SourceManifest,
} from "../../chat/citations";
import {
  type ChatMessage as ClientChatMessage,
  type ChatModel,
  type ChatUsage,
  streamChat,
} from "../../chat/client";
import { planRequestBudget } from "../../chat/budget";
import { buildContext } from "../../chat/context";
import { expandQuestion, hitsToContext, searchTerms } from "../../chat/expand";
import { effectiveMaxAnswerTokens, resolveContextBudget } from "../../chat/contextBudget";
import { connectedProviders, disconnect as disconnectProvider } from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import {
  clearAll as clearAllHistory,
  clearThread as clearThreadHistory,
  createThread,
  exportHistory,
  getMessages as getHistoryMessages,
  getRun,
  listThreads,
  saveMessage,
  saveRun,
  serializeManifest,
} from "../../chat/history";
import { buildMessages } from "../../chat/prompt";
import { estimateProseTokens } from "../../chat/tokens";
import {
  emptyReason,
  expansionContributed,
  mergeUsage,
  type TurnExpansion,
  type TurnPhase,
} from "../../chat/turn";
import type { ContextChip, DroppedSource, StudySource } from "../../chat/types";
import { useWorks } from "../../data/hooks";
import { useStore, type PaneSourceType } from "../../state/store";
import { ChatDisclaimer } from "./ChatDisclaimer";
import { ChatMessage } from "./ChatMessage";
import { ChatSources } from "./ChatSources";
import { ContextPicker, summarizeContext } from "./ContextPicker";
import { initialLoggingConfirmed, ModelPicker, type ModelPickerHandle } from "./ModelPicker";
import { TurnPanel } from "./TurnPanel";

const HISTORY_NOTICE_KEY = "bible-chat-history-notice-dismissed";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  incomplete?: boolean;
  // "length" means max_tokens cut the answer off — actionable (raise the answer budget),
  // unlike a stream that simply ended early.
  finishReason?: string | null;
  errorKind?: ChatErrorKind;
  // Routers substitute models (m9.0-findings.md §9: 5 requests, 5 different models), so
  // this is what actually answered, not what was requested — plan §17 requires it visible.
  actualModel?: string;
  usage?: ChatUsage;
  // Captured at send time and immutable thereafter (§7): a later context change must
  // never retroactively change what an old citation in THIS message resolves to.
  manifest?: SourceManifest;
  contextSummary?: string; // shown on the user message it was sent with (§5)
  // M9.4: the confirmed terms this answer was grounded through. Metadata, never part of
  // `text` — text is replayed to the model as history on the next turn.
  expansion?: TurnExpansion;
}

const newMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The Assistant content rendered inside ChatDrawer. Grounded per M9.3: the picked context
 * is retrieved and budgeted (context.ts), assembled into a system contract plus labelled
 * source blocks (prompt.ts), and every citation in the streamed answer resolves only
 * against the manifest captured for that exact turn (citations.ts).
 */
export function ChatPanel({
  onClose,
  onCitationNavigate,
}: {
  onClose: () => void;
  onCitationNavigate?: (paneType: PaneSourceType | null) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const composerId = useId();

  const panes = useStore((s) => s.panes);
  const updatePane = useStore((s) => s.updatePane);
  const openPassage = useStore((s) => s.openPassage);
  const openCommentary = useStore((s) => s.openCommentary);
  const openDictionary = useStore((s) => s.openDictionary);
  const openBookSection = useStore((s) => s.openBookSection);
  const requestOpenNote = useStore((s) => s.requestOpenNote);
  const uiLang = useStore((s) => s.settings.uiLang);
  const chatPerSourceCap = useStore((s) => s.settings.chatPerSourceCap);
  const chatTotalBudget = useStore((s) => s.settings.chatTotalBudget);
  const chatMaxAnswerTokens = useStore((s) => s.settings.chatMaxAnswerTokens);
  const works = useWorks();

  const [connected, setConnected] = useState(() => connectedProviders().includes("openrouter"));
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [privacyRouting, setPrivacyRouting] = useState(true);
  const [loggingConfirmed, setLoggingConfirmedState] = useState(initialLoggingConfirmed);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<TurnPhase>({ kind: "idle" });
  // Session-scoped, off by default: every chip-less question silently costing two model
  // calls is the reader's money under BYOK, and §17's "all context visible before sending"
  // holds only if a turn's shape is something the reader chose.
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [privateSession, setPrivateSession] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyNoticeDismissed, setHistoryNoticeDismissed] = useState(
    () => localStorage.getItem(HISTORY_NOTICE_KEY) === "1",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Per-turn state that is not UI: the conversation as it stood before the turn began,
  // and the expansion call's usage/model until the answering call's arrive to be merged.
  const turnRef = useRef<{
    priorHistory: ClientChatMessage[];
    expansionMeta?: { usage?: ChatUsage; actualModel?: string };
  } | null>(null);
  const confirmResolverRef = useRef<((terms: string[] | null) => void) | null>(null);
  // A turn can sit at the confirm step indefinitely while the reader changes the model,
  // ticks chips, or edits the budget. Each stage reads these at the moment it runs, so the
  // request reflects what the toolbar shows — never the render that started the turn.
  const latestRef = useRef({ chips, selectedModel, privacyRouting, works, uiLang, chatPerSourceCap, chatTotalBudget, chatMaxAnswerTokens });
  latestRef.current = { chips, selectedModel, privacyRouting, works, uiLang, chatPerSourceCap, chatTotalBudget, chatMaxAnswerTokens };
  // Set by a pre-stream cancel; the effect below focuses the composer once it is enabled.
  const focusComposerRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<ModelPickerHandle>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Reload finds saved history: on mount (never in a private session), pick up the most
  // recently updated thread and restore its messages, including each assistant answer's
  // manifest, so old citations still resolve and its Sources panel still shows.
  useEffect(() => {
    if (privateSession) return;
    let alive = true;
    (async () => {
      const threads = await listThreads();
      const latest = threads[0];
      if (!latest || !alive) return;
      const stored = await getHistoryMessages(latest.id);
      const restored: DisplayMessage[] = await Promise.all(
        stored.map(async (m) => {
          if (m.role !== "assistant") {
            return { id: m.id, role: m.role, text: m.text, contextSummary: m.contextSummary };
          }
          const run = await getRun(m.id);
          return {
            id: m.id,
            role: m.role,
            text: m.text,
            incomplete: m.incomplete,
            finishReason: run?.finishReason,
            actualModel: run?.actualModel,
            usage: run?.usage,
            manifest: run ? buildManifest(JSON.parse(run.sourceManifestJson) as StudySource[]) : [],
            expansion: run?.expansion,
          };
        }),
      );
      if (!alive) return;
      setThreadId(latest.id);
      setMessages(restored);
    })();
    return () => {
      alive = false;
    };
    // Intentionally mount-only: switching privateSession mid-session does not reload —
    // it only changes whether future sends persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissHistoryNotice = () => {
    localStorage.setItem(HISTORY_NOTICE_KEY, "1");
    setHistoryNoticeDismissed(true);
  };

  const clearThisThread = async () => {
    if (!window.confirm(t("chat.history.clearThreadConfirm"))) return;
    if (threadId) await clearThreadHistory(threadId);
    setThreadId(null);
    setMessages([]);
  };

  const clearAllHistoryAndReset = async () => {
    if (!window.confirm(t("chat.history.clearAllConfirm"))) return;
    await clearAllHistory();
    setThreadId(null);
    setMessages([]);
  };

  const exportJson = async () => {
    downloadJson("bible-chat-history.json", await exportHistory());
  };

  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  // Click outside closes the overflow menu; scrolling must not (no scroll listener here).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  // Focus the first item when the menu opens. Without this, opening the menu leaves focus
  // on the gear button, whose keydown events never pass through the menu element — so
  // Escape reached ChatDrawer's window handler and closed the entire workspace while
  // leaving the menu itself open.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>("input, button:not(:disabled)")?.focus();
  }, [menuOpen]);

  // Bound to the wrapper, not the menu element, so it also catches Escape raised on the
  // gear button itself — focus can be there whenever the menu is open (it is restored
  // there on close, and a reader can shift-tab back to it). Guarded on menuOpen so that
  // Escape on the button with no menu open still reaches ChatDrawer and closes the
  // workspace, which is the behaviour everywhere else in the panel.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen || event.key !== "Escape") return;
    event.stopPropagation();
    closeMenu();
  };

  const disconnect = () => {
    abortRef.current?.abort();
    disconnectProvider("openrouter");
    setConnected(false);
    setSelectedModel(null);
    setLoggingConfirmedState(false);
  };

  // Two flags with different jobs (§7 [R3]). `turnActive` is any turn in any phase and
  // guards everything that must not run mid-turn — sending, the composer, and both
  // history-clearing actions, whose closure hazard is explained at the menu below.
  // `streaming` is the answering call specifically: Stop during it keeps the partial answer.
  const turnActive = phase.kind !== "idle";
  const streaming = phase.kind === "streaming";
  const showStop = phase.kind === "expanding" || phase.kind === "searching" || streaming;
  const canSend = connected && selectedModel !== null && input.trim().length > 0 && !turnActive;

  const navigateToSource = (source: StudySource) => {
    const intent = navigationIntent(source);
    let paneType: PaneSourceType | null = null;
    switch (intent.action) {
      case "openPassage":
        openPassage(intent.workId, intent.osis, intent.chapter, intent.verse);
        paneType = "bible";
        // An xref source's canonicalTarget is its anchor verse, not any one of the
        // (possibly several) cross-references it summarizes — there is no single "the
        // target reference" to jump to. Selecting the anchor verse instead opens the
        // existing cross-reference tools panel (BiblePane's useCrossReferences), which
        // shows the actual reference list the excerpt was built from.
        if (source.kind === "xref" && intent.verse != null) {
          const pane = useStore
            .getState()
            .panes.find(
              (p) => p.type === "bible" && p.workId === intent.workId && p.osis === intent.osis && p.chapter === intent.chapter,
            );
          if (pane) updatePane(pane.id, { selectedVerse: intent.verse });
        }
        break;
      case "openCommentary":
        openCommentary(intent.workId, intent.osis, intent.chapter);
        paneType = "commentary";
        break;
      case "openDictionary":
        openDictionary(intent.workId, intent.headword);
        paneType = "dictionary";
        break;
      case "openBookSection":
        openBookSection(intent.workId, intent.sectionId);
        paneType = "book";
        break;
      case "requestOpenNote":
        requestOpenNote(intent.noteId, intent.osis, intent.chapter);
        paneType = "notes";
        break;
    }
    onCitationNavigate?.(paneType);
  };

  // --- The turn, as a phase machine (plan/chat/m9.4-topical-questions.md §7, §7a) ----------
  // Toggle off: idle -> streaming, and runAnswer is M9.3's send() body. Toggle on: no row
  // exists in React or Dexie until runAnswer, so a pre-stream cancel has nothing to remove.

  // Exactly one chain may own the phase. A stage that finds its controller is no longer
  // abortRef.current has been superseded — by Stop, a second click, or a newer action —
  // and must not touch state the newer chain now owns.
  const isCurrent = (controller: AbortController) => abortRef.current === controller;

  const cancelTurn = (question: string, controller?: AbortController) => {
    if (controller && !isCurrent(controller)) return;
    abortRef.current = null;
    confirmResolverRef.current = null;
    turnRef.current = null;
    setPhase({ kind: "idle" });
    setInput(question);
    // Not focused here: the textarea is still disabled until the idle render paints, and
    // focusing a disabled field is a no-op — the effect below does it once enabled.
    focusComposerRef.current = true;
  };

  const errorKindOf = (err: unknown): ChatErrorKind =>
    err instanceof ChatError ? err.kind : err instanceof DOMException && err.name === "AbortError" ? "aborted" : "network";

  // A pre-stream failure hosts on the phase — there is no assistant row yet to attach it
  // to — with Retry and Cancel for every kind (turn.ts errorActions). An abort is the
  // reader's own Stop and is a clean cancel, not an error.
  const failPreStream = (err: unknown, question: string, controller: AbortController, terms?: string[]) => {
    if (!isCurrent(controller)) return;
    const kind = errorKindOf(err);
    if (kind === "aborted") {
      cancelTurn(question, controller);
      return;
    }
    abortRef.current = null;
    setPhase({
      kind: "error",
      question,
      error: kind,
      terms,
      retryAfterSeconds: err instanceof ChatError ? err.retryAfterSeconds : undefined,
    });
  };

  // Every phase in which an action is legal — idle, error, empty — leaves abortRef null, so
  // a non-null ref means an attempt is already in flight. Actions check it before starting
  // work: a second click before React re-renders (same closure, same phase) is a no-op,
  // never a second chain. The FIRST click wins. runAnswer creates rows and writes Dexie
  // before its first abortable await, so superseding a chain after the fact could not
  // have been made clean; refusing to start it can.
  const attemptInFlight = () => abortRef.current !== null;
  const beginAttempt = (): AbortController => {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  // Stage 1: question -> proposed terms -> the reader confirms or edits them.
  const runExpansion = async (question: string, controller: AbortController) => {
    const { selectedModel: model, privacyRouting: privacy, uiLang: lang } = latestRef.current;
    if (!model) {
      cancelTurn(question, controller);
      return;
    }
    setPhase({ kind: "expanding", question });
    let proposed: string[];
    let expansionMeta: { usage?: ChatUsage; actualModel?: string };
    try {
      const result = await expandQuestion(question, model, privacy, controller.signal, lang === "bg" ? "bg" : "en");
      proposed = result.terms;
      expansionMeta = { usage: result.usage, actualModel: result.actualModel };
    } catch (err) {
      failPreStream(err, question, controller);
      return;
    }
    await awaitConfirmThenSearch(question, proposed, controller, expansionMeta);
  };

  // The confirm wait is a promise the phase resolves: Search resolves it with the edited
  // terms, Cancel/Escape with null, and the turn's abort with null — so nothing in this
  // path can hang, which a bare `await` in the middle of send() could (abort() rejects
  // fetches, not arbitrary promises).
  const awaitConfirmThenSearch = async (
    question: string,
    proposed: string[],
    controller: AbortController,
    expansionMeta: { usage?: ChatUsage; actualModel?: string },
  ) => {
    if (!isCurrent(controller)) return;
    const confirmed = await new Promise<string[] | null>((resolve) => {
      // Never leave an earlier waiter dangling: it is the one promise in the turn that no
      // fetch rejection can unwind.
      confirmResolverRef.current?.(null);
      confirmResolverRef.current = resolve;
      controller.signal.addEventListener("abort", () => resolve(null), { once: true });
      setPhase({ kind: "confirm", question, terms: proposed });
    });
    if (!isCurrent(controller)) return;
    confirmResolverRef.current = null;
    if (confirmed === null || controller.signal.aborted) {
      cancelTurn(question, controller);
      return;
    }
    if (turnRef.current) turnRef.current.expansionMeta = expansionMeta;
    await runSearch(question, confirmed, controller);
  };

  // Stage 2: confirmed terms -> hits -> context. Gated on the COMPLETE manifest (§7a):
  // chips get dropped too, so "the reader has chips" is not evidence of grounding.
  const runSearch = async (question: string, terms: string[], controller: AbortController) => {
    if (!isCurrent(controller)) return;
    setPhase({ kind: "searching", question, terms });
    try {
      const hits = await searchTerms(terms, controller.signal);
      const { chips: readerChips, works: currentWorks, privacyRouting: privacy, ...budgets } = latestRef.current;
      const { chips: hitChips, extras } = hitsToContext(hits, currentWorks ?? []);
      const budgetLimits = resolveContextBudget(budgets);
      const prepared = await buildContext(
        [...readerChips, ...hitChips],
        currentWorks ?? [],
        privacy,
        controller.signal,
        budgetLimits,
        extras,
      );
      if (!isCurrent(controller)) return;
      if (prepared.sources.length === 0) {
        abortRef.current = null;
        setPhase({ kind: "empty", question, terms, reason: emptyReason(hits.length, prepared.dropped) });
        return;
      }
      await runAnswer(question, controller, {
        prepared,
        expansion: {
          terms,
          contributed: expansionContributed(prepared.sources, hitChips, extras),
          model: turnRef.current?.expansionMeta?.actualModel,
        },
      });
    } catch (err) {
      failPreStream(err, question, controller, terms);
    }
  };

  // Stage 3 — the answering call. This is M9.3's send() body: rows are created here, the
  // user message is saved here, and everything after buildContext is unchanged. `prepared`
  // is supplied by the search path, which already ran buildContext for the §7a gate; the
  // toggle-off path builds it here exactly as before.
  const runAnswer = async (
    question: string,
    controller: AbortController,
    opts: {
      prepared?: { sources: StudySource[]; dropped: DroppedSource[] };
      expansion?: TurnExpansion;
    } = {},
  ) => {
    if (!isCurrent(controller)) return;
    const { selectedModel: model, chips: readerChips, works: currentWorks, privacyRouting: privacy, uiLang: lang, ...budgets } = latestRef.current;
    if (!model) {
      cancelTurn(question, controller);
      return;
    }
    const priorHistory = turnRef.current?.priorHistory ?? [];
    const expansionUsage = turnRef.current?.expansionMeta?.usage;
    const userText = question;

    const userId = newMessageId();
    const assistantId = newMessageId();
    setPhase({ kind: "streaming", question });
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: userText },
      { id: assistantId, role: "assistant", text: "", expansion: opts.expansion },
    ]);

    let currentThreadId = threadId;
    const userCreatedAt = Date.now();
    let assistantText = "";
    try {
      // Inside the try: a storage failure here is a streaming-phase error like any
      // other — it lands on the assistant row and the turn settles — rather than a
      // rejection that leaves the phase at `streaming` with a Stop that does nothing.
      if (!privateSession) {
        currentThreadId ??= await createThread(userText);
        setThreadId(currentThreadId);
        await saveMessage({ id: userId, threadId: currentThreadId, role: "user", text: userText, createdAt: userCreatedAt });
      }

      const budgetLimits = resolveContextBudget(budgets);
      // Never above the model's own ceiling: a max_tokens larger than the model allows is
      // a request the provider rejects outright.
      const answerTokens = effectiveMaxAnswerTokens(budgetLimits, model.maxCompletionTokens);
      const { sources, dropped } =
        opts.prepared ??
        (await buildContext(
          readerChips,
          currentWorks ?? [],
          privacy,
          controller.signal,
          budgetLimits,
        ));
      const manifest = buildManifest(sources);

      const answerLanguage = lang === "bg" ? "bg" : "en";
      const [system, user] = buildMessages(sources, userText, answerLanguage);

      // Bound the whole request, not just its sources: the replayed conversation is
      // unbounded on its own and the model's window has to hold all of it plus the answer.
      const budget = planRequestBudget(priorHistory, {
        fixedTokens: estimateProseTokens(system.content) + estimateProseTokens(user.content),
        maxCompletionTokens: answerTokens,
        contextLength: model.contextLength,
      });

      const baseSummary = summarizeContext(
        sources,
        dropped,
        t,
        budget.droppedTurns,
        budgetLimits.perSourceCap,
      );
      // §7a: grounded by the reader's chips alone, the terms shown must not read as the
      // answer's evidence — the summary says so, as the terms row does.
      const contextSummary =
        opts.expansion && !opts.expansion.contributed
          ? `${baseSummary} ${t("chat.expansion.summaryNoContribution")}`
          : baseSummary;
      setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, contextSummary } : m)));
      // buildContext only resolves after the user message is already saved (needed
      // immediately, to have a thread to save it under), so the summary — required to be
      // stored with the turn (§5, §9) — arrives via a second put to the same id.
      if (!privateSession && currentThreadId) {
        await saveMessage({
          id: userId,
          threadId: currentThreadId,
          role: "user",
          text: userText,
          createdAt: userCreatedAt,
          contextSummary,
        });
      }

      // Raised only after the summary is stored, so the reader can see what was too large.
      if (budget.overflows) {
        throw new ChatError("contextOverflow", "The selected context exceeds the model's window.");
      }
      const requestMessages: ClientChatMessage[] = [system, ...budget.history, user];

      const meta = await streamChat(
        {
          providerId: "openrouter",
          model: model.id,
          messages: requestMessages,
          maxTokens: answerTokens,
          privacyRouting: privacy,
          reasoningCaps: model.reasoning,
          signal: controller.signal,
        },
        {
          onDelta: (text) => {
            assistantText += text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + text } : m)),
            );
          },
          onMeta: (partial) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      actualModel: partial.actualModel ?? m.actualModel,
                      // Summed with the expansion call's usage, never replaced by it: the
                      // reader sees one answer and must be shown everything it cost.
                      usage: partial.usage ? mergeUsage(expansionUsage, partial.usage) : m.usage,
                    }
                  : m,
              ),
            );
          },
        },
      );
      const usage = mergeUsage(expansionUsage, meta.usage ?? undefined);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                incomplete: meta.incomplete,
                finishReason: meta.finishReason,
                actualModel: meta.actualModel ?? m.actualModel,
                usage: usage ?? m.usage,
                manifest,
              }
            : m,
        ),
      );
      if (!privateSession && currentThreadId) {
        await saveMessage({
          id: assistantId,
          threadId: currentThreadId,
          role: "assistant",
          text: assistantText,
          createdAt: Date.now(),
          incomplete: meta.incomplete,
        });
        await saveRun({
          messageId: assistantId,
          sourceManifestJson: serializeManifest(sources),
          contentVersion: sources[0]?.contentVersion ?? "unknown",
          actualModel: meta.actualModel ?? undefined,
          usage,
          finishReason: meta.finishReason,
          expansion: opts.expansion,
        });
      }
    } catch (err) {
      const kind = errorKindOf(err);
      setMessages((prev) => (kind === "aborted" ? prev : prev.map((m) => (m.id === assistantId ? { ...m, errorKind: kind } : m))));
    } finally {
      // A superseded chain's rows stay as its aborted partial; the phase belongs to the
      // chain that superseded it.
      if (isCurrent(controller)) {
        setPhase({ kind: "idle" });
        abortRef.current = null;
        turnRef.current = null;
      }
    }
  };

  const send = async () => {
    if (!canSend || !selectedModel || attemptInFlight()) return;
    const question = input.trim();
    setInput("");
    // Strip citation markers before replaying prior turns: StudySource ids are reassigned
    // fresh every turn, so a prior [S1] means nothing about the current manifest's S1, and
    // a model that reuses it would have that reused id resolve to real but unrelated
    // content — citations.ts's resolve() only guards against an id outside the manifest,
    // not a misattribution to a real one that happens to share a stale id.
    //
    // Captured once here, before any row for this turn exists, and carried in turnRef for
    // every stage and retry: recomputed later it would include the in-flight question.
    const priorHistory: ClientChatMessage[] = messages
      .filter((m) => !m.errorKind && m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: stripCitationMarkers(m.text) }));
    turnRef.current = { priorHistory };
    const controller = beginAttempt();
    if (searchEnabled) await runExpansion(question, controller);
    else await runAnswer(question, controller);
  };

  // Panel actions. Each reads the question from the phase, never from the composer, which
  // was cleared at send.
  const retry = () => {
    if ((phase.kind !== "error" && phase.kind !== "empty") || attemptInFlight()) return;
    const controller = beginAttempt();
    if (phase.kind === "error" && phase.terms) void runSearch(phase.question, phase.terms, controller);
    else void runExpansion(phase.question, controller);
  };
  const editTerms = () => {
    if (phase.kind !== "empty" || attemptInFlight()) return;
    const controller = beginAttempt();
    void awaitConfirmThenSearch(phase.question, phase.terms, controller, turnRef.current?.expansionMeta ?? {});
  };
  // One-shot: the ordinary M9.3 turn over the reader's own chips, with no search and no
  // §7a gate — a deliberately chosen ungrounded turn if there are no chips. Leaves the
  // session toggle where the reader set it.
  const sendWithoutSearch = () => {
    if ((phase.kind !== "error" && phase.kind !== "empty") || attemptInFlight()) return;
    void runAnswer(phase.question, beginAttempt());
  };
  const cancel = () => {
    if (phase.kind === "idle" || phase.kind === "streaming") return;
    if (phase.kind === "confirm") confirmResolverRef.current?.(null);
    else cancelTurn(phase.question);
  };

  // The composer is disabled while a turn is active, so focus can only return to it after
  // the idle render — never in the same tick as the transition.
  useEffect(() => {
    if (phase.kind === "idle" && focusComposerRef.current) {
      focusComposerRef.current = false;
      composerRef.current?.focus();
    }
  }, [phase.kind]);
  const confirmTerms = (terms: string[]) => confirmResolverRef.current?.(terms);
  const openPicker = () => modelPickerRef.current?.open();

  // preventDefault, on a type="button": a pre-stream Stop restores the question and goes
  // idle inside the click's own microtasks, and React then reuses this DOM node for the
  // Send button — so by the time the browser runs the click's default action, the node it
  // was clicked on is an enabled submit button, and the turn Stop just cancelled is sent
  // again. Found by e2e-chat/topical.spec.ts; invisible to jsdom.
  const stop = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    abortRef.current?.abort();
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <h2 id={headingId}>{t("chat.title")}</h2>
        <button type="button" onClick={onClose} aria-label={t("chat.close")}>
          {t("chat.close")}
        </button>
      </div>

      <ChatDisclaimer hasMessages={messages.length > 0} />

      {!historyNoticeDismissed && (
        <aside className="chat-history-notice" role="note">
          <p>{t("chat.history.firstUseNotice")}</p>
          <button type="button" onClick={dismissHistoryNotice}>
            {t("common.dismiss")}
          </button>
        </aside>
      )}

      <ul className="chat-messages" aria-live="polite" aria-label={t("chat.messages")}>
        {messages.map((m) => (
          <li key={m.id} className={`chat-message chat-message-${m.role}`}>
            {m.role === "assistant" ? (
              <ChatMessage text={m.text} manifest={m.manifest ?? []} onCitationClick={navigateToSource} />
            ) : (
              <span className="chat-message-text">{m.text}</span>
            )}
            {m.contextSummary && <p className="chat-context-summary">{m.contextSummary}</p>}
            {m.role === "assistant" && m.expansion && (
              <p className="chat-expansion-terms">
                {t(m.expansion.contributed ? "chat.expansion.termsRow" : "chat.expansion.termsRowNoContribution", {
                  terms: m.expansion.terms.join(", "),
                })}
              </p>
            )}
            {m.incomplete && (
              <span className="chat-message-flag">
                {m.finishReason === "length" ? t("chat.truncatedByAnswerLimit") : t("chat.incomplete")}
              </span>
            )}
            {m.errorKind && (
              <span className="chat-message-flag" role="alert">
                {t(`chat.error.${m.errorKind}`)}
              </span>
            )}
            {m.role === "assistant" && (m.actualModel ?? m.usage) && (
              <span className="chat-message-meta">
                {m.actualModel && (
                  <span className="chat-message-model">{t("chat.answeredBy", { model: m.actualModel })}</span>
                )}
                {m.usage?.totalTokens != null && (
                  <span className="chat-message-usage">
                    {t("chat.tokensUsed", { count: m.usage.totalTokens })}
                  </span>
                )}
                {m.usage?.promptTokens != null && m.usage?.completionTokens != null && (
                  <span className="chat-usage-split">
                    {t("chat.tokensSplit", {
                      prompt: m.usage.promptTokens.toLocaleString(),
                      completion: m.usage.completionTokens.toLocaleString(),
                    })}
                    {m.usage.reasoningTokens != null && m.usage.reasoningTokens > 0 && (
                      <> {t("chat.tokensReasoning", { reasoning: m.usage.reasoningTokens.toLocaleString() })}</>
                    )}
                  </span>
                )}
                {m.usage?.isByok && <span className="chat-message-byok">{t("chat.byok")}</span>}
              </span>
            )}
            {m.role === "assistant" && m.manifest && (
              <ChatSources manifest={m.manifest} actualModel={m.actualModel} usage={m.usage} />
            )}
          </li>
        ))}
      </ul>

      <ContextPicker
        panes={panes}
        privacyRouting={privacyRouting}
        loggingConfirmed={loggingConfirmed}
        onChipsChange={setChips}
        searchFirst={searchEnabled}
      />

      <form
        className="chat-composer"
        // The model popover and its settings render inside this form, so any control there
        // with a min/max/step constraint can make the form :invalid — and an invalid form
        // silently refuses to submit, which here means Send stops working with nothing on
        // screen to explain it. Budget values are clamped by resolveContextBudget anyway,
        // so browser constraint validation buys nothing and only adds that failure mode.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <TurnPanel
          phase={phase}
          onConfirm={confirmTerms}
          onCancel={cancel}
          onRetry={retry}
          onEditTerms={editTerms}
          onSwitchModel={openPicker}
          onOpenSettings={openPicker}
          onSendWithoutSearch={sendWithoutSearch}
        />
        <label className="sr-only" htmlFor={composerId}>
          {t("chat.composer.label")}
        </label>
        <textarea
          id={composerId}
          ref={composerRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!connected || turnActive}
        />
        <div className="chat-composer-toolbar">
          <ModelPicker
            ref={modelPickerRef}
            connected={connected}
            onConnected={() => setConnected(true)}
            onDisconnect={disconnect}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            privacyRouting={privacyRouting}
            onPrivacyRoutingChange={setPrivacyRouting}
            loggingConfirmed={loggingConfirmed}
            onLoggingConfirmedChange={setLoggingConfirmedState}
          />
          <label className="chat-search-toggle" title={t("chat.expansion.toggleHelp")}>
            <input
              type="checkbox"
              checked={searchEnabled}
              onChange={(event) => setSearchEnabled(event.target.checked)}
              disabled={!connected || selectedModel === null || turnActive}
            />
            {t("chat.expansion.toggle")}
          </label>
          {/* Answer-language control (follow UI / English / Bulgarian) is out of scope for
              this refit (plan/chat/m9.3b-chat-layout.md, "Out of scope") — this is its slot. */}
          <div className="chat-overflow-menu" onKeyDown={onMenuKeyDown}>
            <button
              type="button"
              ref={menuButtonRef}
              className="chat-overflow-menu-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={t("chat.menu.open")}
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              ⚙
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={t("chat.menu.open")}
                className="chat-overflow-menu-popover"
              >
                <label className="chat-menu-item" role="menuitemcheckbox" aria-checked={privateSession}>
                  <input
                    type="checkbox"
                    checked={privateSession}
                    onChange={(e) => setPrivateSession(e.target.checked)}
                  />
                  {t("chat.history.privateSession")}
                </label>
                {/* Disabled while a turn is active in ANY phase, not only while streaming:
                    the turn's closure holds currentThreadId and priorHistory and, when it
                    finishes, saves the assistant message/run under that thread regardless
                    of what happened elsewhere — clearing mid-turn would leave those writes
                    to resurrect it as orphaned data, visible in a later Export JSON, and
                    to replay messages the reader believes are gone. A confirm step is a
                    turn in flight. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void clearThisThread();
                  }}
                  disabled={messages.length === 0 || turnActive}
                >
                  {t("chat.history.clearThread")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void clearAllHistoryAndReset();
                  }}
                  disabled={turnActive}
                >
                  {t("chat.history.clearAll")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void exportJson();
                  }}
                >
                  {t("chat.history.exportJson")}
                </button>
              </div>
            )}
          </div>
          {showStop ? (
            <button type="button" onClick={stop}>
              {t("chat.stop")}
            </button>
          ) : phase.kind === "idle" ? (
            <button type="submit" disabled={!canSend}>
              {t("chat.send")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
