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
 * `categories.icon`. Labels are the French names read by VoiceOver in the icon picker.
 */
export const CATEGORY_ICONS = {
  carrot: { icon: Carrot, label: 'Carotte' },
  apple: { icon: Apple, label: 'Pomme' },
  wheat: { icon: Wheat, label: 'Blé' },
  fish: { icon: Fish, label: 'Poisson' },
  beef: { icon: Beef, label: 'Viande' },
  milk: { icon: Milk, label: 'Lait' },
  croissant: { icon: Croissant, label: 'Croissant' },
  popcorn: { icon: Popcorn, label: 'Pop-corn' },
  cookie: { icon: Cookie, label: 'Biscuit' },
  candy: { icon: Candy, label: 'Bonbon' },
  sunrise: { icon: Sunrise, label: 'Matin' },
  can: { icon: Can, label: 'Conserve' },
  snowflake: { icon: Snowflake, label: 'Flocon' },
  soup: { icon: Soup, label: 'Soupe' },
  'cup-soda': { icon: CupSoda, label: 'Soda' },
  citrus: { icon: Citrus, label: 'Agrume' },
  'glass-water': { icon: GlassWater, label: 'Verre d’eau' },
  wine: { icon: Wine, label: 'Vin' },
  beer: { icon: Beer, label: 'Bière' },
  coffee: { icon: Coffee, label: 'Café' },
  'cooking-pot': { icon: CookingPot, label: 'Marmite' },
  baby: { icon: Baby, label: 'Bébé' },
  'paw-print': { icon: PawPrint, label: 'Patte' },
  'brush-cleaning': { icon: BrushCleaning, label: 'Brosse' },
  'soap-dispenser-droplet': { icon: SoapDispenserDroplet, label: 'Savon' },
  scroll: { icon: Scroll, label: 'Rouleau' },
  pill: { icon: Pill, label: 'Gélule' },
  shapes: { icon: Shapes, label: 'Formes' },
  egg: { icon: Egg, label: 'Œuf' },
  cherry: { icon: Cherry, label: 'Cerise' },
  grape: { icon: Grape, label: 'Raisin' },
  banana: { icon: Banana, label: 'Banane' },
  salad: { icon: Salad, label: 'Salade' },
  sandwich: { icon: Sandwich, label: 'Sandwich' },
  pizza: { icon: Pizza, label: 'Pizza' },
  drumstick: { icon: Drumstick, label: 'Volaille' },
  ham: { icon: Ham, label: 'Jambon' },
  'cake-slice': { icon: CakeSlice, label: 'Gâteau' },
  'ice-cream-cone': { icon: IceCreamCone, label: 'Glace' },
  lollipop: { icon: Lollipop, label: 'Sucette' },
  nut: { icon: Nut, label: 'Noix' },
  bean: { icon: Bean, label: 'Haricot' },
  'leafy-green': { icon: LeafyGreen, label: 'Feuilles' },
  martini: { icon: Martini, label: 'Cocktail' },
  bone: { icon: Bone, label: 'Os' },
  cat: { icon: Cat, label: 'Chat' },
  dog: { icon: Dog, label: 'Chien' },
  droplets: { icon: Droplets, label: 'Gouttes' },
} as const satisfies Record<string, { icon: LucideIcon; label: string }>;

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
