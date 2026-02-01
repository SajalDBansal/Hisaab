/**
 * Hands a newly created party or item back to the form that opened "Add new".
 *
 * The sale form opens /party/new; after saving, the new screen calls
 * `setPicked("party", id)` and goes back. The sale form calls
 * `takePicked("party")` when it comes back into focus and selects it.
 */
type Kind = "party" | "item";
const pending: Partial<Record<Kind, string>> = {};

export function setPicked(kind: Kind, id: string) {
  pending[kind] = id;
}

export function takePicked(kind: Kind): string | undefined {
  const id = pending[kind];
  delete pending[kind];
  return id;
}
