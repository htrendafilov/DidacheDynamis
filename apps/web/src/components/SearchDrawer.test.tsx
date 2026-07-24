import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { SEARCH_MAX_WIDTH, SEARCH_MIN_WIDTH, SearchDrawer, clampSearchWidth } from "./SearchDrawer";

// SearchPanel pulls in the store + API; stub it so this test focuses on the drawer shell.
vi.mock("./SearchPanel", () => ({ SearchPanel: () => <div data-testid="panel" /> }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

function renderDrawer(props: Partial<ComponentProps<typeof SearchDrawer>> = {}) {
  const onWidthChange = vi.fn();
  render(
    <SearchDrawer
      open
      fullscreen={false}
      width={380}
      onWidthChange={onWidthChange}
      onClose={() => {}}
      {...props}
    />,
  );
  return { onWidthChange };
}

describe("SearchDrawer", () => {
  it("docks with a set width and a resize handle when open on desktop", () => {
    renderDrawer();
    const drawer = document.querySelector(".search-drawer") as HTMLElement;
    expect(drawer.className).toContain("docked");
    expect(drawer.className).toContain("open");
    expect(drawer.style.width).toBe("380px");
    expect(screen.getByRole("separator", { name: "Resize search" })).toBeInTheDocument();
  });

  it("is hidden (but still mounted) when closed", () => {
    renderDrawer({ open: false });
    const drawer = document.querySelector(".search-drawer") as HTMLElement;
    expect(drawer.className).toContain("closed");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("panel")).toBeInTheDocument(); // panel stays mounted -> state persists
  });

  it("becomes full-screen with no resize handle on mobile", () => {
    renderDrawer({ fullscreen: true });
    const drawer = document.querySelector(".search-drawer") as HTMLElement;
    expect(drawer.className).toContain("fullscreen");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("clamps the width to [min, max]", () => {
    expect(clampSearchWidth(380)).toBe(380);
    expect(clampSearchWidth(10)).toBe(SEARCH_MIN_WIDTH);
    expect(clampSearchWidth(9999)).toBe(SEARCH_MAX_WIDTH);
  });

  it("reports a new width only while dragging the handle", () => {
    const { onWidthChange } = renderDrawer();
    const handle = screen.getByRole("separator", { name: "Resize search" });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerMove(handle, { pointerId: 1 }); // no drag in progress -> ignored
    expect(onWidthChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1 });
    expect(onWidthChange).toHaveBeenCalledOnce();

    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1 }); // drag ended -> ignored
    expect(onWidthChange).toHaveBeenCalledOnce();
  });
});
