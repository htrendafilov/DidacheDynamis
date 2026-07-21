import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { SourceSelector } from "./SourceSelector";

describe("SourceSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("offers the M6 General Books pane as an enabled source", () => {
    const onChange = vi.fn();
    render(<SourceSelector type="bible" onChange={onChange} />);
    const option = screen.getByRole("option", { name: "Books" });
    expect(option).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "book" },
    });
    expect(onChange).toHaveBeenCalledWith("book");
  });
});
