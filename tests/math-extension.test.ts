import { describe, expect, it } from "vitest";
import { renderLatex } from "../src/renderer/math-extension";

describe("math rendering", () => {
  it("keeps a preview for valid and invalid LaTeX", () => {
    expect(renderLatex("\\frac{1}{2}", false)).toMatchObject({ error: "" });
    expect(renderLatex("\\not-a-command", false)).toMatchObject({ error: expect.any(String) });
  });
});
