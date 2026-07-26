# Interactive AI Chat Window — Reassessed Proposal (Architecture Variants, Model Landscape, Cost & Privacy Analysis)

Status: **proposal / research report** — no code committed. Companion to, and reassessment of,
[`interactive_chat_feature_proposal.md`](interactive_chat_feature_proposal.md) (see §11 appendix).

> **Verification caveat.** Model names, prices, and free-tier limits below are a snapshot and change
> monthly. Verify the current landscape (provider pricing pages, OpenRouter model list, Ollama
> library) at implementation time before committing to any preset.

## 1. Резюме (на български)

Този документ предлага архитектура за интерактивен AI чат прозорец в двуезичното приложение за
изучаване на Библията. Чатът ще отговаря на български и английски на въпроси като: „Обясни ми този
стих", „Защо е използвана тази дума, а не синоним?", „Направи ми план на тази книга/глава",
„Обобщи тази книга/глава/стих", „Къде в Писанието се говори за X?".

**Препоръка:** първа версия с клиентски BYOK модел (потребителят въвежда собствен API ключ в
браузъра) с предварително извличане на контекст (pre-retrieval RAG) през съществуващите read-only
API крайни точки. Предложени пресети: безплатният tier на Gemini (hosted) и OpenRouter `:free`
модели, плюс пресет за локален модел през Ollama за потребители, които предпочитат пълна
поверителност. Сървърно proxy с ключ на разработчика се отлага като по-късна, изрично обусловена
опция (изисква решение на собственика, защото променя архитектурната граница). Ключовете се
пазят само в браузъра и никога не се изпращат към нашия сървър — същият модел като Dropbox синка.

**Ограничения:** съдържанието днес е само на английски (българският ББД текст чака разрешение), така
че цитатите в отговорите ще са от английски преводи, докато не се публикува български текст.
Изпращането на откъси към външни LLM API-та днес е с нисък риск (public domain / CrossWire GPL);
бъдещият лицензиран ББД текст е решение-гейт. Функцията „защо тази дума" временно ще разчита на
знанията на модела с дисклеймър, докато M8 (Strong's) не бъде доставен.

## 2. Executive Summary

This report proposes variants for an interactive chat window in the bilingual Bible study app.
Capabilities in scope:

- Explain a verse (exegesis with commentary context)
- Explain word choice vs. a synonym (lexical nuance)
- Outline a book or chapter (structure)
- Summarize a book, chapter, or verse (abstractive)
- Topical "where is X written about" lookup (RAG over FTS5 search)

**Recommended path:**

1. **V1 — client-side BYOK with pre-retrieval RAG** as the first milestone. Zero backend change,
   preserves the read-only server boundary, keys stay in the browser (Dropbox-sync precedent).
   Provider presets: Gemini free tier (hosted default), OpenRouter `:free` models, and an
   **Ollama local-endpoint preset** for privacy-conscious users.
2. **V2 — tool/function calling** as a follow-up for multi-step topical queries.
3. **V3 — server-side proxy with a developer-funded key** only if BYOK adoption proves the feature
   and the owner accepts the architecture change (§5.3).

## 3. Constraints Inherited from the Repository

| Constraint | Source | Consequence for chat |
| :--- | :--- | :--- |
| Production server is 100% read-only/stateless | `AGENTS.md`, `plan/00_system_design.md` §3 | Chat must not introduce server-side mutable state; BYOK runs entirely in the browser |
| "AI explanations" is an explicit v1 non-goal | `plan/00_system_design.md` §9 | Chat is a new milestone (sketched as M9.x in §10), not a v1 patch |
| Third-party credential pattern: browser-held token, never sent to the app server | `plan/frontend/frontend_design.md` §4 (Dropbox sync) | API keys live in `localStorage`/`sessionStorage` only |
| Content is English-only today (WEB, KJV, MHC, Easton's, TSK, 1689 Confession) | `plan/content_and_licensing.md` | Answers can be in Bulgarian, but retrieved context and quotations are English until a BG text ships → cross-lingual RAG strategy (§4) |
| ББД permission pending; PD fallback is 1871 Tsarigrad | `plan/content_and_licensing.md` | Future licensed BG text may forbid delivery to external LLM APIs → decision gate (§8) |
| Shipped works are PD or CrossWire-GPL | `plan/content_and_licensing.md` | Sending excerpts to third-party LLM APIs is low-risk **today** |
| M8 Strong's lexical data designed, not shipped | `plan/search_workspace.md` §10 | "Why this word" answers are interim LLM-knowledge answers with a disclaimer; M8 is the upgrade hook |
| FTS5 search indexes English text only | `apps/api` search provider design | A Bulgarian topical query must be translated/expanded to EN keywords before `/api/v1/search` (§4) |
| All retrieval plumbing exists as read-only GETs | `apps/web/src/data/api.ts` | No backend work needed for V1/V2 (`passage`, `commentary`, `dictionaryEntry`, `crossReferences`, `search`) |

## 4. Feature → Retrieval Mapping

Each capability maps to existing client API calls (`apps/web/src/data/api.ts`). Context is injected
into the prompt; the LLM never calls the app API directly in V1.

| Capability | API calls | Context injected | Prompt language strategy | Est. tokens/turn |
| :--- | :--- | :--- | :--- | :--- |
| Explain verse | `passage` + `commentary` (MHC) + `crossReferences` (TSK) + `dictionaryEntry` for key terms | Verse text (EN), MHC entry, TSK refs, 1–2 dictionary excerpts | User asks in BG or EN; system prompt instructs "answer in the user's language; quote scripture in English and label the translation" | ~2–4k |
| Word choice vs. synonym | `passage` (interlinear n/a) | Verse text + explicit note: "original-language lexical data (M8) not yet available; answer from general knowledge and mark it as such" | Same; answer carries an interim disclaimer | ~1–2k |
| Outline book/chapter | `passage` (chapter) or headings-only for whole books | Chapter text + WEB section headings (`headings` table in `content.sqlite`); long books → headings-only or chunked chapters | Same | ~2–6k |
| Summarize book/chapter/verse | Same retrieval as outline | Same | Abstractive prompt: "summarize faithfully, do not add doctrine" | ~2–6k |
| "Where is X written about" | LLM translates/expands BG query → EN keywords → `search` (bible + commentary + dictionary kinds) | Top-N hits with refs and snippets | LLM synthesizes an answer with citations; each citation rendered as a clickable deep link (§9) | ~3–5k |

Notes:

- **Cross-lingual RAG.** Retrieved context is English; answers may be Bulgarian. The system prompt
  must state this explicitly so the model does not hallucinate a Bulgarian Bible quotation. Verse
  quotations are labeled with the source work (e.g. WEB) until a BG text ships.
- **Topical search gotcha.** `/api/v1/search` FTS5 indexes English text only. The translate/expand
  step ("вяра" → "faith, believe, trust") is a concrete required design point, not a nice-to-have.
  In V1 this happens as a small LLM pre-call; in V2 it becomes a tool call.
- **M8 upgrade hook.** The word-choice feature is designed so that when `plan/search_workspace.md`
  §10 ships (Strong's numbers, `strong_lexicon`), the retrieval column gains a lexical lookup and
  the interim disclaimer is removed.

## 5. Architecture Variants

### 5.1 V1 — Client-side BYOK, pre-retrieval RAG (recommended first)

Flow: user asks → `apps/web` reads current context (pane `workId`/`osis`/`chapter` from the
zustand store) → parallel GETs to existing endpoints → prompt assembled in the browser → direct
streaming `fetch` to the user's chosen LLM provider with the user's key.

- **Pros:** deterministic; 1 local API round + 1 streaming LLM call; lowest token cost; zero
  backend change; preserves the read-only boundary; keys never leave the browser (Dropbox
  precedent, `plan/frontend/frontend_design.md` §4).
- **Cons:** key friction (user must obtain a key); no shared free tier funded by the project;
  quality depends on the user's chosen provider.

### 5.2 V2 — Client-side BYOK + tool/function calling

The LLM is given tool definitions (`search_bible`, `get_passage`, `lookup_dictionary`,
`get_cross_references`) and drives retrieval itself in a loop executed by the browser.

- **Pros:** handles open-ended multi-step study workflows ("find all passages about X, look up the
  dictionary term, then summarize"); topical BG queries benefit most (LLM picks the EN keywords
  itself).
- **Cons:** more LLM round-trips → higher latency and token cost; tool-calling support is uneven on
  free tiers; harder to test deterministically. Build after V1 validates demand.

### 5.3 V3 — Server-side proxy, developer-funded key

`POST /api/v1/chat` relays prompts to an LLM with a server-held key.

- **Pros:** zero user friction; enables a shared free tier; central rate-limiting and caching.
- **Cons:** cost exposure and quota management; abuse surface; an outbound call plus a server-held
  secret; logging/privacy questions (what the server sees).
- **Decision gate:** the DB stays read-only (no writes), but this is still a deliberate
  architecture change per `AGENTS.md` ("anything that would give the server mutable state … is a
  deliberate future architecture change, not a v1 patch") and needs owner sign-off. Present as
  gated, not forbidden.

### 5.4 V4 — Local models (Ollama / LM Studio)

An OpenAI-compatible endpoint on the user's machine (`http://localhost:11434/v1`) is just another
provider preset in the same BYOK settings UI — no separate code path beyond an endpoint field.

- **Pros:** free, private (nothing leaves the machine), offline; no key needed.
- **Cons:** setup burden (install Ollama, pull a multi-GB model); hardware requirements (§6.2);
  Bulgarian quality drops sharply below ~14B parameters.

### 5.5 V5 — In-browser inference (WebLLM / transformers.js) — rejected

Models small enough to run in a browser tab (~1–4B) are too weak in Bulgarian for exegesis-quality
answers, and the multi-GB download is worse UX than installing Ollama. Mentioned for completeness;
not recommended.

### 5.6 Recommended rollout

V1 with provider presets (Gemini free tier, OpenRouter `:free`, Ollama endpoint field) → V2 tool
calling → V3 only if BYOK adoption proves the feature and the owner accepts the architecture
change. V5 rejected.

## 6. Model Comparison

> Snapshot estimates — **verify pricing/availability at implementation time.**

### 6.1 Hosted

| Provider / model | BG quality | Context | Rough cost ($/1M tok, in/out) | Free tier | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Google Gemini 2.5 Flash / 2.0 Flash (AI Studio) | Strong | 1M | ~$0.15–0.30 / ~$1.20–2.50 | Generous daily RPM/RPD caps | Recommended hosted default |
| OpenAI GPT-4o-mini / GPT-4.1-mini | Strong | 128k | ~$0.15–0.40 / ~$0.60–1.60 | None meaningful | Solid fallback preset |
| Anthropic Claude Haiku (3.5/4.x) | Strong | 200k | ~$0.80–1.00 / ~$4.00–5.00 | None | Best-in-class instruction following; pricier |
| DeepSeek-Chat (V3.x) | Good–strong | 64–128k | ~$0.25–0.30 / ~$0.40–1.10 | Trial credit | Very cheap paid tier |
| Qwen3 32B / 235B-A22B via OpenRouter `:free` | Good–strong | 32–128k | $0 (`:free`) or ~$0.10–0.30 paid | Daily request caps on `:free` | Zero-cost BYOK option; caps vary |
| Qwen2.5-72B via OpenRouter/DeepInfra | Good | 32–128k | ~$0.07–0.20 | Provider-dependent | Budget champion when `:free` unavailable |

### 6.2 Local (Ollama / LM Studio)

| Model | BG quality | Q4 VRAM (approx.) | Hardware class | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Qwen3 14B | Good | ~12 GB | Mid-range GPU / 16 GB Mac | Best BG-per-GB at consumer sizes; recommended local default |
| Qwen3 32B | Strong | ~20–24 GB | High-end GPU / 32–36 GB Mac | Best local BG quality short of 70B |
| Gemma 3 12B | Fair–good | ~8–10 GB | Mid-range | Decent multilingual; weaker BG nuance than Qwen3 |
| Gemma 3 27B | Good–strong | ~20 GB | High-end | Strong general quality |
| Llama 3.3 70B | Strong | ~40 GB | Workstation / 48–64 GB Mac | Workstation-only; excellent but heavy |
| Mistral Small 3 (24B) | Fair–good | ~16 GB | Mid-high | BG below Qwen3-32B; fast |

Honest assessment: below ~14B parameters, Bulgarian output degrades (grammar errors, anglicisms,
lost theological register). Do not offer presets under 12B except explicitly labeled "fast/draft".

### 6.3 Recommendation

- Hosted default preset: **Gemini 2.5 Flash free tier**.
- Zero-cost BYOK preset: **OpenRouter Qwen3 `:free`** variants (with cap warning).
- Local default preset: **Qwen3 14B**, with 32B offered for capable hardware.

## 7. Cost Analysis

Snapshot estimates; re-verify before launch.

- Typical turn: ~2–4k tokens (system prompt + retrieved context + user query + streamed answer).
- Per-turn cost (paid tiers): fractions of a cent on Gemini Flash / GPT-4o-mini / DeepSeek;
  up to ~$0.01 on Claude Haiku.
- Monthly at 100 chats/day (~3k chats/mo): low single-digit dollars on cheap tiers.
- Monthly at 1,000 chats/day: tens of dollars on cheap tiers; Claude Haiku materially higher.
- Free-tier sufficiency: Gemini AI Studio free tier and OpenRouter `:free` daily caps plausibly
  cover personal/dev usage; they are per-key, so in the BYOK model each user's own free tier
  applies and the project pays nothing.

## 8. Security & Privacy

1. **Key storage.** API keys live in `localStorage`/`sessionStorage` in the browser only, never
   proxied through the app server — the established Dropbox-token pattern
   (`plan/frontend/frontend_design.md` §4).
2. **What leaves the device.** The user query plus retrieved excerpts (verse text, commentary,
   dictionary snippets) are sent to the third-party LLM provider the user selected. Nothing is sent
   to the app server beyond the existing read-only GETs.
3. **Content assessment (today).** All shipped works are public domain (WEB, KJV, MHC, Easton's,
   TSK) or CrossWire-GPL, so excerpt delivery to LLM APIs is low-risk.
4. **Decision gate — future ББД.** The ББД Bulgarian text is copyrighted and its license may forbid
   shipping its text to external APIs. Before a licensed BG text ships, the owner must decide:
   exclude BG text from LLM context (quote EN only), obtain explicit permission, or gate the chat
   feature for that work. This is a gate, not a blocker, for the EN-only launch state.
5. **V3-specific notes.** If the server proxy is ever built, add: key in server secrets (never the
   repo), per-IP rate limits, prompt/response logging policy, and provider ToS review.
6. **Docs follow-up.** When the feature is built, `docs/extra/security-and-privacy.md` needs a
   chat-privacy section covering items 1–4.

## 9. UI/UX Sketch

- **Shell.** Reuse the `SearchDrawer` pattern (`apps/web/src/components/SearchDrawer.tsx`): docked
  resizable drawer on desktop (keyboard-operable resize separator), fullscreen sheet on mobile,
  focus trap and restore, Escape to close.
- **Streaming.** Responses stream token-by-token; a "stop" button aborts the fetch. Announce
  streaming state via an ARIA live region (polite) so screen-reader users know an answer is in
  progress and when it completes.
- **Citations.** Scripture references detected in answers render via the existing deep-link
  infrastructure (`#/b/<work>/<osis>/<chapter>`) and `ScriptureRef` popups — clickable, consistent
  with the rest of the app.
- **History.** Chat sessions persisted client-side in IndexedDB, versioned like the search history
  pattern in `SearchPanel.tsx` (`bible-search-v1` localStorage versioning) so future schema changes
  migrate cleanly. Nothing is synced server-side.
- **Context chip.** The drawer shows the current pane context (work/book/chapter from the zustand
  store's `Pane` shape) with an option to include/exclude it.
- **i18n.** All chat strings in EN and BG with a key-parity test mirroring
  `i18n/searchTranslations.test.ts`.
- **Settings.** Provider preset dropdown (Gemini / OpenRouter / OpenAI / Anthropic / Ollama
  endpoint), key field (password input, stored browser-only), model override, and a clear
  "key never leaves this device" notice.

## 10. Milestone Sketch (informational, not committed)

| Milestone | Scope |
| :--- | :--- |
| M9.1 | Settings UI + provider abstraction (presets incl. Ollama endpoint), key storage, i18n strings + parity test |
| M9.2 | RAG chat MVP: drawer shell, context assembly, streaming, citations, IndexedDB history ✅ criteria: explain-verse and summarize work end-to-end in BG and EN |
| M9.3 | Topical search (translate/expand → `search`) + V2 tool calling behind a flag |
| M9.4 | Local-model preset polish, M8 lexical hook when Strong's ships, privacy docs update |

Decision gates before any build: owner approval of the milestone itself (v1 non-goal list), and the
ББД licensing gate in §8.4 if a BG text ships first.

## 11. Appendix: Critique of the Previous Proposal

Factual differences vs. `interactive_chat_feature_proposal.md` (kept untouched):

1. **Model names.** The previous report cites "Gemini 3.6 Flash" and "Qwen 3.5", which do not
   correspond to verifiable model releases. This report uses real, checkable names and adds an
   explicit verify-at-implementation-time caveat (§6).
2. **Pricing tables.** Previous per-provider prices are not reproduced here; this report gives
   ranges flagged as snapshot estimates instead.
3. **No local-model analysis.** Added (§5.4, §6.2), including VRAM table and honest BG-quality
   assessment per size class.
4. **No server-proxy or hybrid variants.** Added V3 with its decision-gate framing (§5.3).
5. **No feature→retrieval mapping.** Added (§4), including the BG-topical-query translation step
   required by the English-only FTS5 index.
6. **No repo-specific licensing/privacy analysis.** Added (§8): PD-content assessment, the ББД
   decision gate, and the required `docs/extra/security-and-privacy.md` follow-up.
7. **No UI reuse plan.** Added (§9): SearchDrawer shell, deep-link citations, IndexedDB history,
   i18n parity test, live-region streaming.
