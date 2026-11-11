import { assertEquals } from '@std/assert';
import { LIMITS, parseRequest, userMessage, validateResults } from './prompt.ts';

Deno.test('parseRequest keeps valid items and drops unknown category hints', () => {
  const req = parseRequest({
    items: [{ id: 'a', name: 'Café moulu Éthiopie', brand: 'Malongo', categoryKey: 'nope' }],
    kinds: ['café moulu', 3],
    examples: [{ name: 'Lait d’avoine', kind: 'lait végétal', categoryKey: 'laitier' }],
  });
  assertEquals(req?.items[0], { id: 'a', name: 'Café moulu Éthiopie', brand: 'Malongo', categoryKey: null });
  assertEquals(req?.kinds, ['café moulu']);
  assertEquals(req?.examples.length, 1);
});

Deno.test('parseRequest rejects empty and oversized batches', () => {
  assertEquals(parseRequest({ items: [] }), null);
  const many = Array.from({ length: LIMITS.maxItems + 1 }, (_, i) => ({ id: String(i), name: 'x' }));
  assertEquals(parseRequest({ items: many }), null);
});

Deno.test('userMessage lists kinds sorted and deduplicated', () => {
  const msg = userMessage({ items: [{ id: 'a', name: 'Riz', brand: null, categoryKey: null }], kinds: ['riz', 'café moulu', 'riz'], examples: [] });
  assertEquals(msg.startsWith('Types déjà utilisés :\n- café moulu\n- riz'), true);
});

Deno.test('validateResults normalises kinds and ignores unknown ids', () => {
  const items = [{ id: 'a', name: 'Café', brand: null, categoryKey: null }];
  const out = validateResults(
    { results: [
      { id: 'a', kind: '  Café  Moulu ', categoryKey: 'cafe', suggestedMin: 1.4 },
      { id: 'a', kind: 'dup', categoryKey: 'cafe', suggestedMin: 1 },
      { id: 'z', kind: 'x', categoryKey: 'cafe', suggestedMin: 1 },
      { id: 'b', kind: 'x', categoryKey: 'bogus', suggestedMin: 1 },
    ] },
    items,
  );
  assertEquals(out, [{ id: 'a', kind: 'café moulu', categoryKey: 'cafe', suggestedMin: 1 }]);
});
