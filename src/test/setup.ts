/**
 * Unit tests assert French copy unless they say otherwise: the reference catalogue, whatever the
 * language of the machine running them. A test of another language calls `setActiveLocale` itself
 * and restores French afterwards.
 */
import { setActiveLocale } from '@/shared/i18n/locale';

setActiveLocale('fr');
