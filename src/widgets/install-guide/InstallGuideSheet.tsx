import { Plus, Share, SquarePlus } from 'lucide-react';
import { closeSheet, useOverlay } from '@/app/navigation';
import { t } from '@/shared/i18n';
import { Button, InstallStep, Sheet, SheetTextButton } from '@/shared/ui';

/** «Ajouter à l’écran d’accueil» (design 03 §4.1.2), `?sheet=install`, over any screen. */
export function InstallGuideSheet() {
  const overlay = useOverlay();
  return (
    <Sheet
      open={overlay.sheet === 'install'}
      onOpenChange={(next) => !next && closeSheet()}
      title={t('install.title')}
      trailing={
        <SheetTextButton emphasis onPress={closeSheet}>
          {t('common.done')}
        </SheetTextButton>
      }
      closeLabel={t('common.close')}
      footer={
        <Button fullWidth onClick={closeSheet}>
          {t('install.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-2">
        <ol className="flex flex-col gap-2">
          <InstallStep
            index={1}
            icon={Share}
            text={<StepText title="install.step1.title" detail="install.step1.detail" />}
          />
          <InstallStep
            index={2}
            icon={SquarePlus}
            text={<StepText title="install.step2.title" detail="install.step2.detail" />}
          />
          <InstallStep
            index={3}
            icon={Plus}
            text={<StepText title="install.step3.title" detail="install.step3.detail" />}
          />
        </ol>
        <p className="type-footnote text-label-secondary">{t('install.footer')}</p>
      </div>
    </Sheet>
  );
}

type StepKey = 'install.step1' | 'install.step2' | 'install.step3';

function StepText({ title, detail }: { title: `${StepKey}.title`; detail: `${StepKey}.detail` }) {
  return (
    <span className="flex flex-col">
      <span className="type-body font-semibold">{t(title)}</span>
      <span className="type-subhead text-label-secondary">{t(detail)}</span>
    </span>
  );
}
