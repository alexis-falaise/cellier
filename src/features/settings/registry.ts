/**
 * Pages of the Réglages sheet that other features own (03 §1.2): the celliers pages
 * (`pantries`, `pantry`, `pantry-new`) and the household activity (`activity`). The owning feature
 * registers its component once at module load:
 *
 *   registerSettingsPage('pantries', PantriesSettingsPage);
 *
 * The component renders the whole page, header included (use `SettingsPageLayout`), and reads its
 * row id from the `id` prop. Until a page is registered the sheet shows a minimal fallback.
 */
import type { ComponentType } from 'react';

export type ExternalSettingsPage = 'pantries' | 'pantry' | 'pantry-new' | 'activity';

export interface ExternalSettingsPageProps {
  /** `&id=` of the page (pantry id), when it has one. */
  id?: string | undefined;
}

const pages = new Map<ExternalSettingsPage, ComponentType<ExternalSettingsPageProps>>();

export function registerSettingsPage(
  page: ExternalSettingsPage,
  component: ComponentType<ExternalSettingsPageProps>,
): void {
  pages.set(page, component);
}

export function registeredSettingsPage(
  page: ExternalSettingsPage,
): ComponentType<ExternalSettingsPageProps> | undefined {
  return pages.get(page);
}
