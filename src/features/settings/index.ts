/**
 * Réglages sheet (`?sheet=settings&page=…`). The tab shell mounts `SettingsSheetHost`; features that
 * own a page of the sheet (celliers, activity) register it and lay it out with `SettingsPageLayout`.
 */

export {
  type ExternalSettingsPage,
  type ExternalSettingsPageProps,
  registerSettingsPage,
} from './registry';
export { SettingsSheetHost } from './SettingsSheetHost';
export { PageLayout as SettingsPageLayout, type PageLayoutProps as SettingsPageLayoutProps } from './ui/common';
