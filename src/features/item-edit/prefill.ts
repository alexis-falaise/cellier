/**
 * Name handed to NewItemSheet by «Créer « {q} »» (design 03 §4.5.2). Not a URL param: the sheet
 * reads it once when it opens and clears it.
 */
let prefill = '';

export function setNewItemPrefill(name: string): void {
  prefill = name.trim();
}

export function takeNewItemPrefill(): string {
  const value = prefill;
  prefill = '';
  return value;
}
