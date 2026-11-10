import { useState } from 'react';
import type { ProductId } from '@/domain/types';
import { useProductViews } from '@/entities/product';
import { t } from '@/shared/i18n';
import { parseBarcode, type ScannedCode } from '@/shared/lib/gtin';
import { Button, ListRow, ListSection, SheetHeader, SheetTextButton, TextField } from '@/shared/ui';
import { looksLikeBarcode } from '../model/entry';
import { CoverPanel } from './CoverPanel';
import { searchProducts } from './productSearch';

export interface ManualEntrySheetProps {
  open: boolean;
  onClose: () => void;
  /** Digits validated as a GTIN (or an in-store code): handled like a scan. */
  onCode: (code: ScannedCode) => void;
  /** A household product found by name. */
  onPick: (productId: ProductId) => void;
}

/** «Saisir un code» (03 §4.4.8): digits are validated as a GTIN on submit, text searches the household's products. */
export function ManualEntrySheet(props: ManualEntrySheetProps) {
  return (
    <CoverPanel open={props.open} onClose={props.onClose} label={t('scanner.manualEntry.title')}>
      {props.open ? <Form {...props} /> : null}
    </CoverPanel>
  );
}

function Form({ onClose, onCode, onPick }: ManualEntrySheetProps) {
  const products = useProductViews();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const isCode = looksLikeBarcode(value);
  const matches = isCode ? [] : searchProducts(products, value);

  const submit = () => {
    if (!isCode) return;
    const parsed = parseBarcode(value);
    if (!parsed.ok) {
      setError(t('scanner.manualEntry.invalid'));
      return;
    }
    onCode(parsed.code);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SheetHeader
        leading={<SheetTextButton onPress={onClose}>{t('common.cancel')}</SheetTextButton>}
        title={t('scanner.manualEntry.title')}
      />
      <ListSection label={t('scanner.manualEntry.title')}>
        <TextField
          label={t('scanner.manualEntry.title')}
          layout="stacked"
          inputMode="text"
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(undefined);
          }}
          placeholder={t('scanner.manualEntry.placeholder')}
          autoFocus
          enterKeyHint="done"
          maxLength={80}
          error={error}
        />
      </ListSection>
      {!isCode && value.trim().length > 0 ? (
        matches.length > 0 ? (
          <ListSection label={t('newItem.existing')}>
            {matches.map((v) => (
              <ListRow key={v.product.id} title={v.product.name} onPress={() => onPick(v.product.id)} />
            ))}
          </ListSection>
        ) : (
          <p className="px-8 type-footnote text-label-secondary">{t('scanner.manualEntry.noResult')}</p>
        )
      ) : null}
      <div className="px-4">
        <Button type="submit" fullWidth disabled={!isCode}>
          {t('common.confirm')}
        </Button>
      </div>
    </form>
  );
}
