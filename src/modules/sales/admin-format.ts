import { RELATIONSHIP_KINDS, type Recipe, type Relationship, type RelationshipKind } from "@/modules/sales/config";

// Plain-text formats for the admin form, so store owners edit rules line by line instead of JSON.
//   Relationships:  Shirts -> Pants, Chinos, Belts | complete_the_look | {to} to complete the look
//   Recipes:        potato curry: potato, onion, green chili
//   Pairs/synonyms: white: beige, navy, black

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

const list = (text: string) =>
  text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export function parseRelationships(text: string): Relationship[] {
  return lines(text).map((line, index) => {
    const [rule = "", kindText = "", reason = ""] = line.split("|").map((part) => part.trim());
    const [from = "", to = ""] = rule.split(/->|→/).map((part) => part.trim());
    if (!from || !to) throw new FormatError(`Relationship line ${index + 1}: use "From -> To, To | kind | reason".`);
    const kind = (kindText || "complementary") as RelationshipKind;
    if (!RELATIONSHIP_KINDS.includes(kind)) {
      throw new FormatError(`Relationship line ${index + 1}: kind must be one of ${RELATIONSHIP_KINDS.join(", ")}.`);
    }
    return { from, to: list(to), kind, reason };
  });
}

export function formatRelationships(rules: Relationship[]): string {
  return rules.map((rule) => `${rule.from} -> ${rule.to.join(", ")} | ${rule.kind}${rule.reason ? ` | ${rule.reason}` : ""}`).join("\n");
}

/** "name: a, b, c" lines into a map (colour pairings, synonyms) or recipes. */
export function parseKeyedLists(text: string, what: string): Array<[string, string[]]> {
  return lines(text).map((line, index) => {
    const at = line.indexOf(":");
    if (at <= 0) throw new FormatError(`${what} line ${index + 1}: use "name: item, item".`);
    const key = line.slice(0, at).trim();
    const values = list(line.slice(at + 1));
    if (!key || values.length === 0) throw new FormatError(`${what} line ${index + 1}: use "name: item, item".`);
    return [key, values];
  });
}

export function parseRecipes(text: string): Recipe[] {
  return parseKeyedLists(text, "Recipe").map(([name, ingredients]) => ({ name, ingredients }));
}

export function formatRecipes(recipes: Recipe[]): string {
  return recipes.map((recipe) => `${recipe.name}: ${recipe.ingredients.join(", ")}`).join("\n");
}

export function parseMap(text: string, what: string): Record<string, string[]> {
  return Object.fromEntries(parseKeyedLists(text, what).map(([key, values]) => [key.toLowerCase(), values]));
}

export function formatMap(map: Record<string, string[]>): string {
  return Object.entries(map)
    .map(([key, values]) => `${key}: ${values.join(", ")}`)
    .join("\n");
}

export function parseLines(text: string): string[] {
  return lines(text);
}
