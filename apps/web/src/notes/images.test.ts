import { describe, expect, it } from "vitest";

import { prepareNoteImage } from "./images";

describe("prepareNoteImage", () => {
  it("rejects formats that can carry active content", async () => {
    const svg = new File(["<svg/>"], "image.svg", { type: "image/svg+xml" });
    await expect(prepareNoteImage(svg)).rejects.toMatchObject({ code: "type" });
  });

  it("rejects oversized input before decoding it", async () => {
    const bytes = new Uint8Array(12 * 1024 * 1024 + 1);
    const image = new File([bytes], "large.png", { type: "image/png" });
    await expect(prepareNoteImage(image)).rejects.toMatchObject({ code: "size" });
  });
});
