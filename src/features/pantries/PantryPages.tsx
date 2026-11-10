import { Plus } from 'lucide-react';
import { useState } from 'react';
import { closeConfirm, openConfirm, popSheetPage, pushSheetPage, useOverlay } from '@/app/navigation';
import { useActiveHousehold } from '@/app/session';
import type { Pantry, PantryId } from '@/domain/types';
import { usePantries, usePantryStock } from '@/entities/pantry';
import { closeConfirmAndWait } from '@/features/item-edit/ui/SheetPage';
import { type ExternalSettingsPageProps, SettingsPageLayout } from '@/features/settings';
import { ReorderList } from '@/features/settings/ui/ReorderList';
import { t } from '@/shared/i18n';
import { ChipGroup, ConfirmDialog, ListRow, ListSection, SheetTextButton, TextField } from '@/shared/ui';
import type { PlainMessageKey } from '@/widgets/item/productText';
import { tryMutate } from '@/widgets/item/stockActions';
import { moveStockPlan, nextSortOrder, type PantryNameError, reorderPlan, validatePantryName } from './model/pantries';
import { useItemCounts } from './model/selectors';

const DELETE = 'pantry-delete';

const NAME_ERRORS: Record<PantryNameError, PlainMessageKey> = {
  required: 'onboarding.create.pantryRequired',
  taken: 'validation.pantryTaken',
};

/** Celliers (design 03 §4.9.2, `page=pantries`): order, counts, «Nouveau cellier»; reorder for the owner. */
export function PantriesSettingsPage(_: ExternalSettingsPageProps) {
  const pantries = usePantries();
  const counts = useItemCounts();
  const { isOwner } = useActiveHousehold();
  const [editing, setEditing] = useState(false);

  const move = (from: number, to: number) => {
    for (const u of reorderPlan(pantries, from, to)) {
      tryMutate('pantry.update', { pantryId: u.id as PantryId, fields: { sortOrder: u.sortOrder } });
    }
  };
  const countLabel = (p: Pantry) => t('common.itemsCount', { n: counts.byPantry.get(p.id) ?? 0 });

  return (
    <SettingsPageLayout
      page="pantries"
      trailing={
        isOwner && pantries.length >= 2 ? (
          <SheetTextButton emphasis={editing} onPress={() => setEditing(!editing)}>
            {editing ? t('common.done') : t('common.edit')}
          </SheetTextButton>
        ) : undefined
      }
    >
      <ListSection
        header={t('pantries.title')}
        footer={isOwner ? t('pantries.footer.owner') : t('pantries.footer.member')}
      >
        {editing ? (
          <ReorderList
            items={pantries}
            getId={(p) => p.id}
            handleLabel={(p) => t('categories.move', { name: p.name })}
            handleHint={t('categories.moveHint')}
            onMove={move}
            renderRow={(p, handle) => (
              <ListRow variant="plain" title={p.name} subtitle={countLabel(p)} trailing={handle} />
            )}
          />
        ) : (
          <>
            {pantries.map((p) =>
              isOwner ? (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={countLabel(p)}
                  onPress={() => pushSheetPage({ page: 'pantry', id: p.id })}
                />
              ) : (
                <ListRow key={p.id} variant="plain" title={p.name} subtitle={countLabel(p)} />
              ),
            )}
            {isOwner ? (
              <ListRow
                variant="button"
                icon={Plus}
                title={t('pantries.new')}
                onPress={() => pushSheetPage({ page: 'pantry-new' })}
              />
            ) : null}
          </>
        )}
      </ListSection>
    </SettingsPageLayout>
  );
}

/** Nouveau cellier: «Annuler» / «Créer», name field and suggestions. */
export function NewPantrySettingsPage(_: ExternalSettingsPageProps) {
  const pantries = usePantries();
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const problem = validatePantryName(name, pantries, null);
  const suggestions = t('pantry.suggestions')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && validatePantryName(s, pantries, null) === null);

  const create = () => {
    setSubmitted(true);
    if (problem) return;
    tryMutate('pantry.create', {
      pantryId: crypto.randomUUID() as PantryId,
      name: name.trim(),
      sortOrder: nextSortOrder(pantries),
    });
    popSheetPage();
  };

  return (
    <SettingsPageLayout
      page="pantry-new"
      leading={<SheetTextButton onPress={popSheetPage}>{t('common.cancel')}</SheetTextButton>}
      trailing={
        <SheetTextButton emphasis disabled={problem === 'required'} onPress={create}>
          {t('common.create')}
        </SheetTextButton>
      }
    >
      <ListSection label={t('field.name')}>
        <TextField
          label={t('field.name')}
          value={name}
          onChange={setName}
          maxLength={40}
          autoFocus
          enterKeyHint="done"
          error={problem && (submitted || problem === 'taken') ? t(NAME_ERRORS[problem]) : undefined}
        />
      </ListSection>
      {suggestions.length > 0 ? (
        <ChipGroup
          className="mx-4"
          label={t('field.name')}
          options={suggestions.map((s) => ({ value: s, label: s }))}
          selected={suggestions.filter((s) => s === name.trim())}
          onToggle={setName}
        />
      ) : null}
    </SettingsPageLayout>
  );
}

/** A cellier (`page=pantry&id=`): name saved on blur, item count, delete with the stock rule. */
export function PantrySettingsPage({ id }: ExternalSettingsPageProps) {
  const pantries = usePantries();
  const found = pantries.find((p) => p.id === id);
  const [last, setLast] = useState<Pantry | undefined>(found);
  if (found && found !== last) setLast(found);
  const pantry = found ?? last;
  if (!pantry) return <SettingsPageLayout page="pantry">{null}</SettingsPageLayout>;
  return <PantryDetail key={pantry.id} pantry={pantry} pantries={pantries} />;
}

function PantryDetail({ pantry, pantries }: { pantry: Pantry; pantries: readonly Pantry[] }) {
  const overlay = useOverlay();
  const { isOwner } = useActiveHousehold();
  const stock = usePantryStock(pantry.id);
  const [name, setName] = useState(pantry.name);
  const [choosingTarget, setChoosingTarget] = useState(false);
  const problem = validatePantryName(name, pantries, pantry.id);
  const inStock = stock.filter((s) => s.quantity > 0);
  const last = pantries.length <= 1;
  const targets = pantries.filter((p) => p.id !== pantry.id);

  const saveName = () => {
    const next = name.trim();
    if (problem) {
      setName(pantry.name);
      return;
    }
    if (next !== pantry.name) tryMutate('pantry.update', { pantryId: pantry.id, fields: { name: next } });
  };

  const remove = async () => {
    await closeConfirmAndWait();
    tryMutate('pantry.delete', { pantryId: pantry.id });
    popSheetPage();
  };

  const moveThenRemove = (target: Pantry) => {
    const plan = moveStockPlan(
      pantry.id,
      target.id,
      inStock.map((s) => ({ productId: s.view.product.id, quantity: s.quantity })),
    );
    for (const args of plan) tryMutate('stock.transfer', args);
    tryMutate('pantry.delete', { pantryId: pantry.id });
    popSheetPage();
  };

  return (
    <SettingsPageLayout page="pantry" title={pantry.name}>
      <ListSection label={t('field.name')}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: focus and blur bubble from the field's input (TextField has no blur prop) */}
        <div onBlur={saveName}>
          <TextField
            label={t('field.name')}
            value={name}
            onChange={setName}
            maxLength={40}
            enterKeyHint="done"
            error={problem ? t(NAME_ERRORS[problem]) : undefined}
          />
        </div>
        <ListRow variant="value" title={t('pantry.items')} value={String(inStock.length)} />
      </ListSection>

      {choosingTarget ? (
        <ListSection header={t('pantry.delete.moveTo')}>
          {targets.map((p) => (
            <ListRow key={p.id} variant="value" title={p.name} onPress={() => moveThenRemove(p)} />
          ))}
          <ListRow variant="button" title={t('common.cancel')} onPress={() => setChoosingTarget(false)} />
        </ListSection>
      ) : isOwner ? (
        <ListSection label={t('pantry.delete')} footer={last ? t('pantry.delete.last') : undefined}>
          <ListRow
            variant="destructive"
            title={t('pantry.delete')}
            disabled={last}
            onPress={last ? undefined : () => openConfirm(DELETE)}
          />
        </ListSection>
      ) : null}

      <ConfirmDialog
        open={overlay.confirm === DELETE}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
        title={t('pantry.delete.title', { pantry: pantry.name })}
        message={inStock.length > 0 ? t('pantry.delete.message', { n: inStock.length }) : undefined}
        actions={
          inStock.length > 0
            ? [
                {
                  label: t('pantry.delete.move'),
                  onPress: () => {
                    setChoosingTarget(true);
                    closeConfirm();
                  },
                },
                { label: t('pantry.delete.withStock'), destructive: true, onPress: () => void remove() },
              ]
            : [{ label: t('pantry.delete'), destructive: true, onPress: () => void remove() }]
        }
        cancelLabel={t('common.cancel')}
      />
    </SettingsPageLayout>
  );
}
