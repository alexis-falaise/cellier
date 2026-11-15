import {
  Apple,
  Baby,
  Banana,
  Bean,
  Beef,
  Beer,
  Bone,
  BrushCleaning,
  CakeSlice,
  Can,
  Candy,
  Carrot,
  Cat,
  Cherry,
  Citrus,
  Coffee,
  Cookie,
  CookingPot,
  Croissant,
  CupSoda,
  Dog,
  Droplets,
  Drumstick,
  Egg,
  Fish,
  GlassWater,
  Grape,
  Ham,
  IceCreamCone,
  LeafyGreen,
  Lollipop,
  type LucideIcon,
  Martini,
  Milk,
  Nut,
  PawPrint,
  Pill,
  Pizza,
  Popcorn,
  Salad,
  Sandwich,
  Scroll,
  Shapes,
  Snowflake,
  SoapDispenserDroplet,
  Soup,
  Sunrise,
  Wheat,
  Wine,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CategoryKey } from '@/domain/types';

/** The 12 category hues (01 §6.1). Colours come from `--cat-<hue>-tile` / `--cat-<hue>-fg`. */
export const CATEGORY_HUES = [
  'tomato',
  'clay',
  'apricot',
  'honey',
  'olive',
  'sage',
  'teal',
  'sky',
  'iris',
  'plum',
  'rose',
  'pebble',
] as const;

export type CategoryHue = (typeof CATEGORY_HUES)[number];

export function isCategoryHue(value: unknown): value is CategoryHue {
  return typeof value === 'string' && (CATEGORY_HUES as readonly string[]).includes(value);
}

/** Inline colours for a hue: Tailwind cannot see class names built at runtime (01 §6.1). */
export function hueStyle(hue: CategoryHue): { tile: string; fg: string } {
  return { tile: `var(--cat-${hue}-tile)`, fg: `var(--cat-${hue}-fg)` };
}

export function tileStyle(hue: CategoryHue): CSSProperties {
  const { tile, fg } = hueStyle(hue);
  return { backgroundColor: tile, color: fg };
}

/**
 * Curated icon set for categories (48 Lucide glyphs, 03 §4.13.2), keyed by Lucide name as stored in
 * `categories.icon`. Their names for VoiceOver are the `category.icon.*` strings.
 */
export const CATEGORY_ICONS = {
  carrot: { icon: Carrot },
  apple: { icon: Apple },
  wheat: { icon: Wheat },
  fish: { icon: Fish },
  beef: { icon: Beef },
  milk: { icon: Milk },
  croissant: { icon: Croissant },
  popcorn: { icon: Popcorn },
  cookie: { icon: Cookie },
  candy: { icon: Candy },
  sunrise: { icon: Sunrise },
  can: { icon: Can },
  snowflake: { icon: Snowflake },
  soup: { icon: Soup },
  'cup-soda': { icon: CupSoda },
  citrus: { icon: Citrus },
  'glass-water': { icon: GlassWater },
  wine: { icon: Wine },
  beer: { icon: Beer },
  coffee: { icon: Coffee },
  'cooking-pot': { icon: CookingPot },
  baby: { icon: Baby },
  'paw-print': { icon: PawPrint },
  'brush-cleaning': { icon: BrushCleaning },
  'soap-dispenser-droplet': { icon: SoapDispenserDroplet },
  scroll: { icon: Scroll },
  pill: { icon: Pill },
  shapes: { icon: Shapes },
  egg: { icon: Egg },
  cherry: { icon: Cherry },
  grape: { icon: Grape },
  banana: { icon: Banana },
  salad: { icon: Salad },
  sandwich: { icon: Sandwich },
  pizza: { icon: Pizza },
  drumstick: { icon: Drumstick },
  ham: { icon: Ham },
  'cake-slice': { icon: CakeSlice },
  'ice-cream-cone': { icon: IceCreamCone },
  lollipop: { icon: Lollipop },
  nut: { icon: Nut },
  bean: { icon: Bean },
  'leafy-green': { icon: LeafyGreen },
  martini: { icon: Martini },
  bone: { icon: Bone },
  cat: { icon: Cat },
  dog: { icon: Dog },
  droplets: { icon: Droplets },
} as const satisfies Record<string, { icon: LucideIcon }>;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;

export function isCategoryIconName(value: unknown): value is CategoryIconName {
  return typeof value === 'string' && Object.hasOwn(CATEGORY_ICONS, value);
}

export interface CategoryVisualDefault {
  icon: CategoryIconName;
  hue: CategoryHue;
}

/** The 28 default categories (01 §6.2): slug → Lucide icon and hue. */
export const DEFAULT_CATEGORY_VISUALS = {
  legumes: { icon: 'carrot', hue: 'sage' },
  fruits: { icon: 'apple', hue: 'rose' },
  feculents: { icon: 'wheat', hue: 'honey' },
  poisson: { icon: 'fish', hue: 'teal' },
  viande: { icon: 'beef', hue: 'tomato' },
  laitier: { icon: 'milk', hue: 'iris' },
  pain: { icon: 'croissant', hue: 'apricot' },
  apero: { icon: 'popcorn', hue: 'olive' },
  epicerie_sucree: { icon: 'cookie', hue: 'clay' },
  chocolat: { icon: 'candy', hue: 'plum' },
  petit_dej: { icon: 'sunrise', hue: 'apricot' },
  conserves: { icon: 'can', hue: 'tomato' },
  surgeles: { icon: 'snowflake', hue: 'sky' },
  plats: { icon: 'soup', hue: 'clay' },
  soft: { icon: 'cup-soda', hue: 'iris' },
  jus: { icon: 'citrus', hue: 'apricot' },
  eau: { icon: 'glass-water', hue: 'sky' },
  vin: { icon: 'wine', hue: 'plum' },
  biere: { icon: 'beer', hue: 'honey' },
  cafe: { icon: 'coffee', hue: 'clay' },
  condiments: { icon: 'cooking-pot', hue: 'olive' },
  bebe: { icon: 'baby', hue: 'iris' },
  animaux: { icon: 'paw-print', hue: 'sage' },
  entretien: { icon: 'brush-cleaning', hue: 'teal' },
  hygiene: { icon: 'soap-dispenser-droplet', hue: 'rose' },
  papier: { icon: 'scroll', hue: 'pebble' },
  pharmacie: { icon: 'pill', hue: 'pebble' },
  autre: { icon: 'shapes', hue: 'pebble' },
} as const satisfies Record<CategoryKey, CategoryVisualDefault>;

export interface CategoryVisual {
  icon: LucideIcon;
  iconName: CategoryIconName;
  hue: CategoryHue;
}

/** Fallback for a custom category without an icon or colour. */
export const GENERIC_CATEGORY_VISUAL: CategoryVisualDefault = { icon: 'shapes', hue: 'pebble' };

/**
 * Resolves the icon and hue of a category row: household overrides first, then the template default, then the
 * generic fallback. Unknown icon names or colours fall back silently.
 */
export function categoryVisual(category: {
  templateKey?: CategoryKey | null;
  icon?: string | null;
  color?: string | null;
}): CategoryVisual {
  const base: CategoryVisualDefault = category.templateKey
    ? DEFAULT_CATEGORY_VISUALS[category.templateKey]
    : GENERIC_CATEGORY_VISUAL;
  const iconName = isCategoryIconName(category.icon) ? category.icon : base.icon;
  const hue = isCategoryHue(category.color) ? category.color : base.hue;
  return { icon: CATEGORY_ICONS[iconName].icon, iconName, hue };
}
