# 09 - GS1 barcodes in French supermarkets: formats, edge cases, parser

Status: research notes, 2026-11-10. Written by a research agent.

Verification legend: **[SRC]** = supported by a page read or search snippet in this session (URL given). **UNVERIFIED** = from general knowledge of the GS1 specs or not confirmed against a primary source in this session. Treat UNVERIFIED items as hypotheses to test with real packs and real French receipts before shipping.

Access note: `gs1.org` PDFs and `gs1.org/standards/id-keys/gtin` returned HTTP 403 to WebFetch. The GS1 France site was not reachable through search. Most "primary" material below therefore comes from GS1 Belgium-Luxembourg, GS1 UK, GS1 Canada, GS1 Netherlands and ref.gs1.org search snippets, plus the Open Food Facts API reference. Items that need the official GS1 General Specifications PDF are marked UNVERIFIED.

---

## 1. Symbologies and how the 1D formats relate

| Format | Digits | Structure | Notes |
|---|---|---|---|
| EAN-13 (GTIN-13) | 13 | 13-digit GTIN, last digit check | Standard grocery code in France. GS1 company prefix 300-379 for France (UNVERIFIED, from GS1 prefix allocation table). |
| EAN-8 (GTIN-8) | 8 | 8-digit GTIN, last digit check | Small packs. Open Food Facts stores it padded to 13 digits. |
| UPC-A (GTIN-12) | 12 | 12 digits, last digit check | Same as EAN-13 with a leading `0`. Same check digit algorithm. |
| UPC-E | 8 (printed) | Zero-suppressed UPC-A, number system `0` or `1` | Expands to a UPC-A (see section 3). Rare on French grocery items. |
| GTIN-14 (ITF-14, GS1-128 carrying AI 01) | 14 | Indicator digit (1-8) + GTIN-13 | Used on cases and multipacks. Indicator `0` means the same GTIN as the EAN-13 inside. |

Relationships:
- UPC-A `X` = EAN-13 `0X`. Any 12-digit UPC-A is an EAN-13 with a leading zero.
- GTIN-14 with indicator `0` = EAN-13 with a leading zero (UNVERIFIED wording; GS1 General Specs section 3).
- An EAN-13 with a leading `0` is also a UPC-A. Both map to the same product key.

[SRC] Open Food Facts treats 12-digit UPC-A and 13-digit EAN as the same product key after padding: "a request for the 12 digit barcode 034000470693 will return the product saved with 'code' 0034000470693" (https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization).

---

## 2. Check digit (GTIN mod 10)

Algorithm (GS1 General Specs, section 7.9; the form below is the standard one, UNVERIFIED against the PDF):
1. Take the data digits without the check digit.
2. Starting from the rightmost data digit, multiply alternately by 3 and 1 (rightmost = 3).
3. Sum the products. Check digit = `(10 - sum % 10) % 10`.

Worked example: EAN-13 `4006381333931`. Body `400638133393`, sum = 89, check = `(10 - 9) % 10 = 1`. Matches.

```ts
// gtin.ts
export type Digits = string; // only [0-9]

/** GS1 mod-10 check digit for the data part (no check digit included). */
export function gtinCheckDigit(body: Digits): number {
  if (!/^\d+$/.test(body)) throw new Error('non-digit in body');
  let sum = 0;
  const n = body.length;
  for (let i = 0; i < n; i++) {
    const d = body.charCodeAt(i) - 48;
    // weight 3 when the digit is in an odd position counted from the right (1-based)
    const weight = (n - i) % 2 === 1 ? 3 : 1;
    sum += d * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Valid GTIN-8, GTIN-12, GTIN-13 or GTIN-14 (length must be one of these). */
export function isValidGtin(code: Digits): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

// Quick self-check. Expected: true, true, false
// isValidGtin('4006381333931') -> true
// isValidGtin('73513537')      -> true   (GTIN-8 example, UNVERIFIED value)
// isValidGtin('4006381333932') -> false
```

---

## 3. UPC-E expansion to UPC-A

[UNVERIFIED] Mapping from the GS1 UPC-E conversion table, reproduced from memory. Check against the GS1 General Specs before relying on it.

Input: number system `NS` (0 or 1), six middle digits `x1..x6`, check `c`.

| x6 | Manufacturer (5 digits) | Item (5 digits) |
|---|---|---|
| 0, 1, 2 | `x1 x2 x6 0 0` | `0 0 x3 x4 x5` |
| 3 | `x1 x2 x3 0 0` | `0 0 0 x4 x5` |
| 4 | `x1 x2 x3 x4 0` | `0 0 0 0 x5` |
| 5-9 | `x1 x2 x3 x4 x5` | `0 0 0 0 x6` |

The UPC-A is `NS + manufacturer + item + check`, with the check recomputed from the 11 digits.

```ts
// upce.ts
import { gtinCheckDigit, isValidGtin } from './gtin';

/** Expand an 8-digit UPC-E (NS + 6 + check) to a 12-digit UPC-A. Returns null if invalid. */
export function expandUpcE(upce8: string): string | null {
  if (!/^[01]\d{6}\d$/.test(upce8)) return null;
  const ns = upce8[0];
  const [x1, x2, x3, x4, x5, x6] = upce8.slice(1, 7);
  let body: string;
  switch (x6) {
    case '0': case '1': case '2':
      body = x1 + x2 + x6 + '0000' + x3 + x4 + x5; break;
    case '3':
      body = x1 + x2 + x3 + '00000' + x4 + x5; break;
    case '4':
      body = x1 + x2 + x3 + x4 + '00000' + x5; break;
    default: // 5-9
      body = x1 + x2 + x3 + x4 + x5 + '0000' + x6; break;
  }
  const upca11 = ns + body; // 11 digits
  const upca = upca11 + gtinCheckDigit(upca11);
  // The printed check digit must match the expanded UPC-A's check digit.
  if (upca.slice(-1) !== upce8.slice(-1)) return null;
  return upca;
}
```

Spot check: UPC-E `04252614` expands to UPC-A `042100005264` (standard textbook example, UNVERIFIED). Run it once against the code above before trusting it.

---

## 4. Normalisation for lookups (Open Food Facts)

[SRC] Open Food Facts reference, https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization:
- Codes of 7 digits or fewer (after leading zeros are removed) are padded to 8 digits.
- Codes of 9 to 12 digits are padded to 13 digits.
- The server normalises the `code` on READ and WRITE. The docs say clients should not pad.
- Codes with 1-2 digits are considered bogus (infrastructure report, https://openfoodfacts.github.io/openfoodfacts-infrastructure/reports/2024-06-20-move-ean8-directories).
- The page does not describe 13-digit or 14-digit input, nor check-digit handling.

Client rules we will apply:
1. Send the digits exactly as decoded. Do not pad before the API call (OFF normalises server side).
2. Reject non-digits and lengths not in {8, 12, 13, 14} before any network call.
3. Reject check-digit failures for EAN-8/UPC-A/EAN-13/GTIN-14 before lookup. A failed check digit means a misread.
4. For our own storage keys only, use a canonical 14-digit GTIN: `code.padStart(14, '0')`. Never send this padded form to OFF, to avoid confusion with its 8/13 rules.
5. Treat `0` + UPC-A and EAN-13 as the same key (canonical GTIN-14 makes this automatic).

Wiki caveat: the OFF wiki Barcodes page had a "TODO: WRITE ME" for the normalisation section (https://wiki.openfoodfacts.org/Barcodes). Use the API reference above.

---

## 5. GS1 prefixes for France

- GS1 France company prefixes fall in the 300-379 range (UNVERIFIED, from GS1 prefix allocation; not re-read in this session).
- A prefix identifies the **issuing GS1 member organisation of the company prefix**, not the product, the brand's nationality, or the place of manufacture.
  - Tells you: the code was allocated by a GS1 member (for France, GS1 France), so the company is registered with GS1.
  - Does not tell you: country of origin, where the product was made, whether it is French produce, or whether the brand is French. A French supermarket private label can use a prefix from another country, and an imported product can carry a French prefix.
  - Does not tell you: anything about the product category. Parsing the prefix for "French product" features will be wrong.
- Prefixes 020-029, 040-049, 200-299 and similar ranges are **restricted circulation** (see section 6). They are not allocated to companies for general sale.

---

## 6. Restricted circulation and variable measure (in-store codes)

### 6.1 Ranges
- **02** (EAN-13 starting `02`): in-store / variable measure, restricted to the issuing retailer's own use. [SRC] GS1 UK: "in-store variable measure barcodes begin with the prefix 02" (https://www.gs1uk.org/how-to-barcode-variable-measure-items).
- **20-29**: restricted circulation, used for variable measure (weighed/priced in store) and for internal retailer codes. [SRC for the existence of the range] GS1 "Summary of GS1 MO Prefixes 20-29" (https://www.gs1.org/docs/barcodes/SummaryOfGS1MOPrefixes20-29.pdf) lists variable measure retail goods, coupon coding and a GS1 France section (2.26). The PDF returned HTTP 403, so the contents of the France section are **UNVERIFIED**.
- **99** and some 98x ranges are used for coupons in EAN-13 (UNVERIFIED).

### 6.2 Layout
The layout depends on the retailer. There is no single French standard that we could verify.
- UK/GS1 template for in-store prefix 02 [SRC, https://www.gs1uk.org/how-to-barcode-variable-measure-items]: `02` + item reference + price or weight verifier + value + check digit. The guidance says in-store codes should be exclusive to a specific retailer.
- Embedded value modes seen in POS documentation (vendor docs, not GS1): price embedded or weight embedded, with the value at a fixed digit position. One POS vendor documents that NSC `2` embedded price places the price starting at digit 6 or 8, versus digit 7 or 9 under EAN (vendor documentation, not GS1, UNVERIFIED for France).
- Netherlands "23-code" for variable price/weight items [SRC, https://www.gs1.nl/en/products-services/digital-identity/other-codes/variable-priceweight-code/]. Not France.
- GS1 Belgium-Luxembourg for variable measure at POS uses GS1 DataMatrix with AI 395n for price per unit [SRC, gs1belu.org search snippet]. This is the 2D path, not EAN-13 prefix 2.

**What we assume (UNVERIFIED, must be tested with real French receipts):**
- Prefix `02` or `2x` with 13 digits = in-store code. Digits 2-6 = item reference (5 digits). Digits 7-11 = embedded value (5 digits). Digit 12 = check digit (valid mod-10 over all 13 digits).
- Embedded value is weight in grams by default. Price-encoded codes will give wrong weights. The parser exposes an encoding option so the app can switch once a store is confirmed.

### 6.3 Detection
- Only the EAN/UPC form starting `02` or `2[0-9]` after expansion to 13 digits.
- A GS1 DataMatrix / QR with AI 390n/391n/392n/393n/394n/395n (price/weight AIs) is also variable measure. AI list: UNVERIFIED (GS1 General Specs, AI table).

### 6.4 Will not be in any database
- A `02` or `2x` in-store code is assigned by a retailer to its own item (or its own weighing scale output). Open Food Facts and any GTIN database will not have it. Look-ups for these codes should return "not found" with kind `variable-measure`, and the app should ask the user for the product name, not show an error.
- The same retailer may reuse codes across branches with different products. Do not cache these as products.

---

## 7. In-store private codes

- Retailers may print internal codes in the EAN-13 space with non-restricted prefixes. These are not GS1-assigned. Treat them as `kind: 'unknown'` unless they match a restricted range.
- Recognised private codes cannot be validated beyond their check digit (UNVERIFIED that they use mod-10).

---

## 8. GS1 DataBar

- **DataBar Omnidirectional / Stacked** is used on fresh produce and coupons (GS1 DataBar on fresh produce is common in France, UNVERIFIED for French produce specifically). Encodes a GTIN-14 (or a restricted GTIN) in a 14-digit form. Often carries a variable-measure AI 2x weight or price.
- **DataBar Expanded (and Stacked Expanded)** can carry AIs (01, 3103 weight, 310n etc.). Expanded codes are the ones most likely to carry weight.
- Scanner: enable GS1 DataBar (all variants). A DataBar read returns the GS1 element string with AIM identifier `]e0` (UNVERIFIED, from ZXing/AIM conventions).
- Fresh produce on DataBar: the GTIN is the **produce item GTIN** (fixed by GS1 for a produce SKU), not a unique code per item. Weight is in the AI or a separate AI 3103.

Sources: https://endlesscommerce.com/barcodes/gs1-databar-expanded/ (vendor, not authoritative). GS1 fresh foods guidance: https://ref.gs1.org/guidelines/fresh-foods (PDF body not readable here; contents UNVERIFIED).

---

## 9. GS1-128 and ITF-14 on multipacks and cases

- **GS1-128** (Code 128 with FNC1 and AI element strings) carries AI 01 (GTIN-14) plus optional AIs (10 batch, 15 best-before, 17 expiry, 00 SSCC on logistics labels).
- **ITF-14** encodes only the GTIN-14 (no AIs). Used on shipping cases.
- **Should the scanner accept them?** Yes, in-app, but only for one purpose: extracting the GTIN-14 and mapping it to the consumer unit. A case label is not a consumer scan.

### 9.1 Mapping GTIN-14 to the consumer unit
- A GTIN-14 with indicator `0` and a GTIN-13 body equal to a consumer EAN-13 is the same product. Map it to that EAN-13 (look up the 13-digit body).
- A GTIN-14 with indicator `1`-`8` is a **different GTIN** for a different packaging level (a case of 6, 12, etc.). Do not map it to the EAN-13 of the single unit. Look it up as-is in OFF; if not found, tell the user it is a case and offer the inner-unit EAN-13 manual entry.
- Our default: ITF-14 and GS1-128 with AI 01 are accepted. The parsed GTIN-14 is stored under the canonical 14-digit key. Only `0`-indicator codes are offered as "same product as your EAN-13".

### 9.2 Multipacks
- [UNVERIFIED, GS1 General Specs section 3] A pack of 6 has its own GTIN, distinct from the single unit's GTIN, because the trade item configuration differs. Packs of 6 in France (e.g., a 6-pack of yoghurts) normally carry an EAN-13 with a different body, not the single unit's EAN-13 with a different indicator.
- Consequence: scanning a 6-pack EAN-13 returns the 6-pack product if it is in OFF. Do not assume the single-unit product.

---

## 10. GS1 Sunrise 2027 (2D migration): status and parsing

### 10.1 Status (as of 2026-11-10)
- [SRC] GS1 Sunrise 2027 target: point-of-sale systems able to read both 1D and 2D codes by the end of 2027. Sources say EAN-13 will remain in use; the phase-out of 1D is **not** the Sunrise aim (vendor blogs: https://www.inflowinventory.com/blog/gs1-sunrise-2027/ ; https://informait.com/news/gs1-sunrise-2027-what-the-barcode-transformation-means-for-your-packaging ; https://www.packworld.com/design/package-design/article/22885258/2027-the-target-for-transition-away-from-1d-gtin-toward-digital-link-2d-barcodes ).
- [SRC] Esko guide: Sunrise is not a legal deadline, and 1D barcodes do not disappear by then (https://www.esko.com/en/blog/what-is-gs1-sunrise-a-practical-guide-for-packaging-teams).
- [SRC] GS1 Global Industry Endorsement Statement on QR codes with GS1 standards, 2024 (https://gs1.org/sites/gs1/files/2024-06/global-industry-endorsement-statement-qr-codes-with-gs1-standards.pdf). Not re-read here.
- [UNVERIFIED] Status in France in 2026: GS1 France publications and French merchant calendars were **not found** in this session. One search snippet mentions a Carrefour France Digital Link pilot (vendor source, UNVERIFIED). Check GS1 France directly before claiming a French date.
- Practical: expect dual marking (EAN-13 + 2D) on packs through 2027 and probably beyond. Keep EAN-13 as the primary key.

### 10.2 2D carriers
- GS1 DataMatrix: element string AI list (not URL).
- GS1 Digital Link QR: URI with GS1 AIs as path segments, e.g. `https://id.gs1.org/01/09506000134352/10/ABC123/17/261231`. Resolver domain and syntax: GS1 Digital Link standard (UNVERIFIED for exact resolver rules; the path pattern is the standard form).

### 10.3 AIs we need
- AI `01` GTIN, fixed 14 digits, zero-padded (UNVERIFIED; GS1 General Specs AI table).
- AI `17` expiry, fixed 6 digits `YYMMDD`. Day `00` means last day of month (UNVERIFIED rule).
- AI `15` best-before, fixed 6 digits `YYMMDD`, same `00` rule (UNVERIFIED).
- AI `10` batch/lot, variable length up to 20 alphanumeric characters, terminated by FNC1 (GS1 separator `\u001d`) unless last (UNVERIFIED).
- ref.gs1.org AI pages were not readable (template placeholders, [SRC] https://ref.gs1.org/ai/01); the values above are from the GS1 General Specs and must be confirmed.

### 10.4 Parsing (TypeScript)

```ts
// gs1.ts
export type AiName = '01' | '10' | '15' | '17';
export interface Gs1Parsed {
  gtin?: string;   // 14 digits, canonical
  expiry?: string; // ISO YYYY-MM-DD
  bestBefore?: string;
  batch?: string;
  raw: Record<string, string>;
}

const FIXED_LEN: Record<string, number> = { '01': 14, '15': 6, '17': 6 };
const VARIABLE = new Set(['10']);
const GS = '\u001d';

/** YYMMDD -> ISO date. Day 00 -> last day of month (UNVERIFIED rule). */
export function yymmddToIso(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  const year = 2000 + yy;
  if (mm < 1 || mm > 12) return undefined;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate(); // last day of month
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1) return undefined; // e.g. 260231
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Parse a GS1 element string, either the parenthesised human form
 * "(01)09506000134352(17)261231(10)ABC" or the raw form with FNC1 (GS) separators.
 */
export function parseElementString(input: string): Gs1Parsed {
  const out: Gs1Parsed = { raw: {} };
  let s = input.trim();

  // Parenthesised form -> raw with GS separators after variable-length AIs.
  if (s.includes('(')) {
    const pairs = [...s.matchAll(/\((\d{2,4})\)([^(]*)/g)];
    s = pairs.map(([, ai, v]) => ai + v).join(GS);
  }
  // Drop AIM symbology identifier if present (]C1 GS1-128, ]d2 DataMatrix, ]Q3 QR, ]e0 DataBar; UNVERIFIED)
  s = s.replace(/^\][A-Za-z]\d/, '');

  let i = 0;
  while (i < s.length) {
    const ai2 = s.slice(i, i + 2);
    if (FIXED_LEN[ai2]) {
      const v = s.slice(i + 2, i + 2 + FIXED_LEN[ai2]);
      out.raw[ai2] = v;
      i += 2 + FIXED_LEN[ai2];
    } else if (VARIABLE.has(ai2)) {
      const end = s.indexOf(GS, i + 2);
      const v = end === -1 ? s.slice(i + 2) : s.slice(i + 2, end);
      out.raw[ai2] = v;
      i = end === -1 ? s.length : end + 1;
    } else {
      break; // unknown AI: stop, keep what we have
    }
  }

  if (out.raw['01']) out.gtin = out.raw['01'];
  if (out.raw['17']) out.expiry = yymmddToIso(out.raw['17']);
  if (out.raw['15']) out.bestBefore = yymmddToIso(out.raw['15']);
  if (out.raw['10']) out.batch = out.raw['10'];
  return out;
}

/** Parse a GS1 Digital Link URI (path form, with optional query-string AIs). */
export function parseDigitalLink(url: string): Gs1Parsed {
  const u = new URL(url);
  const segs = u.pathname.split('/').filter(Boolean);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < segs.length; i += 2) {
    if (/^\d{2,4}$/.test(segs[i])) pairs.push(segs[i] + decodeURIComponent(segs[i + 1]));
  }
  // Query-string AIs (secondary data), e.g. ?17=261231
  for (const [k, v] of u.searchParams) {
    if (/^\d{2,4}$/.test(k)) pairs.push(k + v);
  }
  // Re-enter the element-string parser with GS separators between variable AIs.
  return parseElementString(pairs.map((p) => p).join(GS));
}
```

Note: in the Digital Link path form, the value after `/10/` may be URI-encoded. The function decodes it. Verify against a real GS1 Digital Link sample before shipping.

---

## 11. Symbologies the scanner should enable

Enable (exact list for the scanner config):
1. EAN-13
2. EAN-8
3. UPC-A
4. UPC-E
5. ITF-14
6. GS1-128 (Code 128 with FNC1)
7. GS1 DataBar Omnidirectional / Stacked / Limited
8. GS1 DataBar Expanded / Stacked Expanded
9. GS1 DataMatrix (for 2D Sunrise codes, e.g. produce and fresh foods)
10. QR Code (for GS1 Digital Link QR)

Do not enable: Code 39, Code 93, Codabar, PDF417, Aztec, Code 128 without FNC1 (saves false reads and speeds decoding). Enable QR and DataMatrix only if the scanner config can filter by GS1 content. Otherwise they produce false positives on non-GS1 QR codes.

---

## 12. `parseScan(raw, format)`

```ts
// parseScan.ts
import { isValidGtin, gtinCheckDigit } from './gtin';
import { expandUpcE } from './upce';
import { parseElementString, parseDigitalLink, Gs1Parsed } from './gs1';

export type Symbology =
  | 'EAN-13' | 'EAN-8' | 'UPC-A' | 'UPC-E' | 'ITF-14' | 'GS1-128'
  | 'GS1-DataBar' | 'GS1-DataBar-Expanded' | 'DataMatrix' | 'QR';

export interface ScanResult {
  gtin: string | null;               // canonical 14-digit GTIN, or null when not a GTIN
  kind: 'product' | 'variable-measure' | 'internal' | 'unknown';
  weightGrams?: number;              // only for variable-measure with weight encoding (UNVERIFIED layout)
  priceCents?: number;               // only for variable-measure with price encoding (UNVERIFIED layout)
  expiry?: string;                   // ISO YYYY-MM-DD, from AI 17 (or 15 if no 17)
}

export interface VariableMeasureConfig {
  encodes: 'weight-g' | 'price-cents'; // retailer-specific; default weight
}

const DEFAULT_VM: VariableMeasureConfig = { encodes: 'weight-g' };

function canonical14(gtin: string): string {
  return gtin.padStart(14, '0');
}

/** Restricted circulation: EAN-13 starting 02 or 20-29 (in-store / variable measure). */
function isRestrictedEan13(ean13: string): boolean {
  return ean13.startsWith('02') || /^2[0-9]/.test(ean13);
}

/** Fields of an assumed in-store code (UNVERIFIED layout): 2-6 item, 7-11 value, 12 check. */
function decodeInStore(ean13: string, cfg: VariableMeasureConfig) {
  const value = Number(ean13.slice(7, 12));
  if (cfg.encodes === 'price-cents') return { priceCents: value };
  return { weightGrams: value };
}

function classifyNumeric(code: string, cfg: VariableMeasureConfig): ScanResult {
  // Non-GTIN lengths or bad check digit -> unknown (misread or private code).
  if (!isValidGtin(code)) return { gtin: null, kind: 'unknown' };

  const gtin14 = canonical14(code);
  // EAN-13 body = GTIN-14 without its indicator digit (only meaningful when indicator is 0).
  const ean13 = gtin14.slice(1);

  if (code.length === 13 || (code.length === 14 && gtin14[0] === '0') || code.length === 12 || code.length === 8) {
    if (isRestrictedEan13(ean13)) {
      // A 13-digit code in the restricted range is a variable-measure code (UNVERIFIED layout).
      return { gtin: null, kind: 'variable-measure', ...decodeInStore(ean13, cfg) };
    }
    return { gtin: gtin14, kind: 'product' };
  }
  // GTIN-14 with indicator 1-8 is a different packaging level: treat as product (the case or pack GTIN).
  return { gtin: gtin14, kind: 'product' };
}

export function parseScan(
  raw: string,
  format: Symbology,
  cfg: VariableMeasureConfig = DEFAULT_VM,
): ScanResult {
  const text = raw.replace(/\r|\n/g, '').trim();

  // 1. GS1 element string or Digital Link URL (2D codes and GS1-128 / DataBar Expanded).
  const looksGs1 =
    text.startsWith('https://') || text.startsWith('http://') ||
    text.startsWith('(') || text.includes('\u001d') || /^\][A-Za-z]\d/.test(text);
  if (format === 'QR' || format === 'DataMatrix' || format === 'GS1-128' || format === 'GS1-DataBar-Expanded' || looksGs1) {
    if (looksGs1) {
      const p: Gs1Parsed = text.startsWith('http') ? parseDigitalLink(text) : parseElementString(text);
      if (p.gtin && /^\d{14}$/.test(p.gtin) && isValidGtin(p.gtin)) {
        const r = classifyNumeric(p.gtin, cfg);
        return { ...r, expiry: p.expiry ?? p.bestBefore };
      }
    }
  }

  // 2. Pure numeric symbologies.
  const digits = text.replace(/\s/g, '');
  if (!/^\d+$/.test(digits)) return { gtin: null, kind: 'unknown' };

  if (format === 'UPC-E') {
    const upca = expandUpcE(digits);
    if (!upca) return { gtin: null, kind: 'unknown' };
    return classifyNumeric(upca, cfg);
  }

  if (format === 'EAN-8' || format === 'UPC-A' || format === 'EAN-13' || format === 'ITF-14' || format === 'GS1-DataBar' || format === 'GS1-DataBar-Expanded') {
    return classifyNumeric(digits, cfg);
  }

  // 3. Fallback: a numeric string with an unexpected format label.
  return classifyNumeric(digits, cfg);
}

// Examples (expected):
// parseScan('4006381333931', 'EAN-13')                -> { gtin:'00400638133931', kind:'product' }
// parseScan('034000470693', 'UPC-A')                  -> { gtin:'00034000470693', kind:'product' }
// parseScan('0210000012345', 'EAN-13')                 -> restricted: kind 'variable-measure' (check digit must be valid)
// parseScan('https://id.gs1.org/01/09506000134352/17/261231', 'QR') -> product + expiry '2026-12-31'
```

Notes on the function:
- `gtin` is the 14-digit canonical form (`padStart(14,'0')`). The app should send the original digits to Open Food Facts, not this padded form (section 4). Store both: `rawCode` for OFF, `gtin14` as our key.
- The `classifyNumeric` default weight decoding is UNVERIFIED. Confirm the encoding per retailer on real labels before showing weights to the user.
- A GTIN-14 with indicator `1`-`8` is returned as `kind: 'product'` with its own GTIN (a case or multipack, section 9). Its EAN-13 body is not mapped to the single unit.
- `expiry` comes from AI 17, falling back to AI 15. Batch is not returned by the spec signature; use `parseElementString(...).batch` if needed.
- Prefix `99` (coupons, UNVERIFIED) is not classified as `internal` in this draft. Add it once a real coupon is tested.

---

## 13. Edge cases checklist

1. UPC-A scanned as EAN-13: same key after the 0 prefix (section 4).
2. UPC-E on produce or small packs: expand before lookup (section 3). Test the expansion on real UPC-E samples.
3. EAN-8 on small items: send digits as-is; OFF pads server side (section 4).
4. In-store `02` / `2x` codes: `variable-measure`, no lookup result expected, ask user for name (section 6.4).
5. Fresh produce on DataBar: the GTIN is the produce SKU, not the item. Weight is in an AI or in the in-store encoding (section 8).
6. Case or multipack labels (ITF-14, GS1-128 with AI 01, indicator 1-8): different GTIN from the single unit (section 9).
7. Misread check digits: reject before lookup (section 2).
8. Sunrise 2D codes: keep the EAN-13 as the lookup key; parse 2D only for AI 17/15/10 and GTIN (section 10).
9. Restricted-prefix products that look like GS1 products: never cache in OFF-keyed storage.
10. Non-GS1 private codes: `unknown`, let the user name the product.

---

## 14. Open items (UNVERIFIED, to resolve before relying on them)

- France-specific prefix range 300-379: confirm against GS1 France or the GS1 prefix table.
- Exact in-store layout used by French retailers for 02 and 2x codes (weight vs price, digit positions, divisor). Requires real labels from 2-3 stores.
- Sunrise France calendar for 2026-2027 and whether French retailers accept GS1 Digital Link at POS yet.
- AI 17 / 15 day `00` rule and AI 10 length (GS1 General Specs AI table).
- Coupon prefix 99 and the 98x range.
- UPC-E expansion table and the expansion example (test with real UPC-E samples).
- DataBar AIM identifiers (`]e0`, `]C1`, `]d2`, `]Q3`).

---

## 15. Sources

Read or searched in this session:
- https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization (read)
- https://openfoodfacts.github.io/openfoodfacts-infrastructure/reports/2024-06-20-move-ean8-directories (search snippet)
- https://wiki.openfoodfacts.org/Barcodes (search snippet; normalisation section "TODO")
- https://www.gs1uk.org/how-to-barcode-variable-measure-items (search snippet)
- https://www.gs1.nl/en/products-services/digital-identity/other-codes/variable-priceweight-code/ (search snippet)
- https://www.gs1belu.org/fr/media/1601/download (search snippet, GS1 Belgium-Luxembourg)
- https://endlesscommerce.com/barcodes/gs1-databar-expanded/ (search snippet, vendor)
- https://ref.gs1.org/guidelines/fresh-foods (fetched; PDF body not readable)
- https://ref.gs1.org/ai/01 (fetched; template placeholders only, no AI content)
- https://www.esko.com/en/blog/what-is-gs1-sunrise-a-practical-guide-for-packaging-teams (search snippet)
- https://gs1.org/sites/gs1/files/2024-06/global-industry-endorsement-statement-qr-codes-with-gs1-standards.pdf (search snippet)
- https://www.packworld.com/design/package-design/article/22885258/2027-the-target-for-transition-away-from-1d-gtin-toward-digital-link-2d-barcodes (search snippet)
- https://www.inflowinventory.com/blog/gs1-sunrise-2027/ (search snippet, vendor)
- https://informait.com/news/gs1-sunrise-2027-what-the-barcode-transformation-means-for-your-packaging (search snippet)
- https://www.gs1ca.org/gs1ca-components/documents/Retail_2D_FAQ_FR.pdf (search snippet, GS1 Canada French FAQ)
- https://www.qrcode-tiger.com/fr/gs1-digital-link (search snippet, vendor)

Not accessible (HTTP 403 or unreadable), so the content above is UNVERIFIED where it depends on them:
- https://www.gs1.org/docs/barcodes/GSCN_18_346_2d_at_POS.pdf (403)
- https://www.gs1.org/docs/barcodes/SummaryOfGS1MOPrefixes20-29.pdf (403)
- https://www.gs1.org/standards/id-keys/gtin (403)
- https://www.gs1.org/1/gtinrules/fr/rule/165/vendu-a-la-piece-puis-decoupe-et-vendu-au-poids (search result; GS1 GTIN rules in French, not fetched)
- https://www.gs1.org/1/gtinrules/fr/rule/138/produit-a-mesure-variable-dont-le-poids-total-varie (search result; not fetched; likely the most relevant French GS1 text for variable-measure, should be read first next time)
- https://www.gs1.org/1/gtinrules/fr/rule/166/vendu-a-la-piece-ou-au-poids (search result; not fetched)
