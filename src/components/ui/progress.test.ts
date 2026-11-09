import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress";

const html = (value: number, max: number, tone?: "expense") => renderToStaticMarkup(createElement(ProgressBar, { value, max, tone, label: "x" }));

describe("ProgressBar", () => {
  it("affiche le réel sur le prévu, avec le ton demandé", () => {
    expect(html(620, 700, "expense")).toBe('<progress class="progress expense" value="620" max="700" aria-label="x"></progress>');
  });
  it("dépassement : pleine et en alerte", () => {
    expect(html(800, 700, "expense")).toBe('<progress class="progress over" value="700" max="700" aria-label="x"></progress>');
  });
  it("prévu nul : vide sans réel, pleine en alerte avec du réel", () => {
    expect(html(0, 0)).toBe('<progress class="progress" value="0" max="1" aria-label="x"></progress>');
    expect(html(50, 0)).toContain('class="progress over" value="1" max="1"');
  });
  it("réel négatif (remboursement) : vide", () => {
    expect(html(-30, 100)).toContain('value="0"');
  });
});
