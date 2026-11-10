import { useState } from 'react';
import { useOverlay } from '@/app/navigation';
import { registerSettingsPage } from '@/features/settings';
import { PantryMenuSheet } from './PantryMenuSheet';
import { NewPantrySettingsPage, PantriesSettingsPage, PantrySettingsPage } from './PantryPages';

// The celliers pages live in the Réglages sheet (`sheet=settings&page=pantries|pantry|pantry-new`).
registerSettingsPage('pantries', PantriesSettingsPage);
registerSettingsPage('pantry', PantrySettingsPage);
registerSettingsPage('pantry-new', NewPantrySettingsPage);

/** Mounted once by the tab shell: PantryMenuSheet for `?sheet=pantries` (the PantrySwitcher's menu). */
export function PantrySheetHost() {
  const overlay = useOverlay();
  const open = overlay.sheet === 'pantries';
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!mounted) return null;
  return <PantryMenuSheet open={open} onExited={() => setMounted(false)} />;
}
