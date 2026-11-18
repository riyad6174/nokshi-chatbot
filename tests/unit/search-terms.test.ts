import { describe, expect, it } from "vitest";
import { termForms, withinOneEdit } from "@/modules/catalog/product.service";

describe("search word matching", () => {
  it("also looks for the singular of a plural word", () => {
    expect(termForms("bags")).toEqual(["bags", "bag"]);
    expect(termForms("watches")).toEqual(["watches", "watch"]);
    expect(termForms("dresses")).toEqual(["dresses", "dress"]);
    expect(termForms("glass")).toEqual(["glass"]);
    expect(termForms("bus")).toEqual(["bus"]);
  });

  it("forgives one wrong, missing, extra or swapped letter", () => {
    expect(withinOneEdit("backpack", "backpak")).toBe(true);
    expect(withinOneEdit("scarf", "scraf")).toBe(true);
    expect(withinOneEdit("scarf", "scarfs")).toBe(true);
    expect(withinOneEdit("tote", "tone")).toBe(true);
    expect(withinOneEdit("backpack", "bakpak")).toBe(false);
    expect(withinOneEdit("scarf", "shirt")).toBe(false);
  });
});
