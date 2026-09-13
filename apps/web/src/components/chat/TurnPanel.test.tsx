import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnPhase } from "../../chat/turn";
import i18n from "../../i18n";
import { TurnPanel, type TurnPanelProps } from "./TurnPanel";

function renderPanel(phase: TurnPhase, overrides: Partial<TurnPanelProps> = {}) {
  const props: TurnPanelProps = {
    phase,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onEditTerms: vi.fn(),
    onSwitchModel: vi.fn(),
    onOpenSettings: vi.fn(),
    onSendWithoutSearch: vi.fn(),
    ...overrides,
  };
  const utils = render(
    // A window listener stands in for ChatDrawer's: it must never see the region's Escape.
    <div>
      <TurnPanel {...props} />
    </div>,
  );
  return { ...utils, props };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => vi.useRealTimers());

describe("TurnPanel — idle and streaming", () => {
  it("renders nothing", () => {
    const { container } = renderPanel({ kind: "idle" });
    expect(container.firstElementChild?.childElementCount).toBe(0);
    const streaming = renderPanel({ kind: "streaming", question: "q" });
    expect(streaming.container.firstElementChild?.childElementCount).toBe(0);
  });
});

describe("TurnPanel — progress", () => {
  it.each([
    ["expanding", "Finding search terms…"],
    ["searching", "Searching the library…"],
  ] as const)("announces %s as a status", (kind, text) => {
    renderPanel({ kind, question: "q", terms: ["a"] } as TurnPhase);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });
});

describe("TurnPanel — confirm", () => {
  const confirm: TurnPhase = { kind: "confirm", question: "q", terms: ["resurrection", "raised"] };

  it("is a labelled region that takes focus itself, not a control", () => {
    renderPanel(confirm);
    const region = screen.getByRole("region", { name: "Search terms" });
    expect(document.activeElement).toBe(region);
  });

  it("states that the search is over English content", () => {
    renderPanel(confirm);
    expect(screen.getByText(/search of English content/)).toBeInTheDocument();
    expect(screen.getByText(/not a Bulgarian Bible search/)).toBeInTheDocument();
  });

  it("confirms with the edited list, not the proposed one", () => {
    const { props } = renderPanel(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Remove raised" }));
    fireEvent.change(screen.getByLabelText("Add term"), { target: { value: " risen " } });
    fireEvent.click(screen.getByRole("button", { name: "Add term" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(props.onConfirm).toHaveBeenCalledWith(["resurrection", "risen"]);
  });

  it("Enter in the add box adds the term and does not submit the surrounding form", () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const { props } = renderPanel(confirm);
    const form = document.createElement("form");
    form.addEventListener("submit", onSubmit);
    const region = screen.getByRole("region");
    region.parentElement!.replaceChild(form, region);
    form.appendChild(region);
    const box = screen.getByLabelText("Add term");
    fireEvent.change(box, { target: { value: "risen" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(props.onConfirm).toHaveBeenCalledWith(["resurrection", "raised", "risen"]);
  });

  it.each(["x", "a".repeat(41), 'life"death', "възкресение", "resurrection"])(
    "rejects a hand-typed term %j with the same rule as a model term, and a duplicate",
    (bad) => {
      const { props } = renderPanel(confirm);
      fireEvent.change(screen.getByLabelText("Add term"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Add term" }));
      expect(screen.getByRole("alert")).toHaveTextContent(/2–40/);
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(props.onConfirm).toHaveBeenCalledWith(["resurrection", "raised"]);
    },
  );

  it("hides the add box at five terms", () => {
    renderPanel({ kind: "confirm", question: "q", terms: ["a1", "a2", "a3", "a4", "a5"] });
    expect(screen.queryByLabelText("Add term")).not.toBeInTheDocument();
  });

  it("disables Search with no terms left; a turn cannot search nothing", () => {
    renderPanel({ kind: "confirm", question: "q", terms: ["only"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove only" }));
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });

  it("Escape cancels the step and does not reach the window, so the drawer stays open", () => {
    const windowEscape = vi.fn();
    window.addEventListener("keydown", windowEscape);
    try {
      const { props } = renderPanel(confirm);
      fireEvent.keyDown(screen.getByLabelText("Add term"), { key: "Escape" });
      expect(props.onCancel).toHaveBeenCalledTimes(1);
      expect(windowEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowEscape);
    }
  });

  it("every control is type=button, since the panel lives inside the composer form", () => {
    renderPanel(confirm);
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("type", "button");
  });
});

describe("TurnPanel — empty", () => {
  it.each([
    ["noHits", /No content matched/],
    ["licence", /none may be sent/],
    ["dropped", /every one was left out/],
  ] as const)("explains %s and offers every exit", (reason, text) => {
    const { props } = renderPanel({ kind: "empty", question: "q", terms: ["a", "b"], reason });
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByText("Terms tried: a, b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit terms" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry expansion" }));
    fireEvent.click(screen.getByRole("button", { name: "Send without search" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onEditTerms).toHaveBeenCalledTimes(1);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(props.onSendWithoutSearch).toHaveBeenCalledTimes(1);
  });
});

describe("TurnPanel — error", () => {
  it("expansionFailed shows the localized message and all four actions", () => {
    const { props } = renderPanel({ kind: "error", question: "q", error: "expansionFailed" });
    expect(screen.getByRole("alert")).toHaveTextContent(/did not return usable search terms/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch model" }));
    fireEvent.click(screen.getByRole("button", { name: "Send without search" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(props.onSwitchModel).toHaveBeenCalledTimes(1);
    expect(props.onSendWithoutSearch).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("auth shows Open settings, Retry and Cancel — never Send without search", () => {
    const { props } = renderPanel({ kind: "error", question: "q", error: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send without search" })).not.toBeInTheDocument();
  });

  it("network offers Retry and Cancel", () => {
    renderPanel({ kind: "error", question: "q", error: "network", terms: ["a"] });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Retry", "Cancel"]);
  });

  it("rateLimit disables Retry through the Retry-After countdown, then enables it", () => {
    vi.useFakeTimers();
    renderPanel({ kind: "error", question: "q", error: "rateLimit", retryAfterSeconds: 2 });
    expect(screen.getByRole("button", { name: "Retry in 2s" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: "Retry in 1s" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeDisabled();
  });
});
