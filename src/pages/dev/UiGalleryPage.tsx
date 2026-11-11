import {
  ArrowUpDown,
  Bell,
  CircleCheck,
  CloudOff,
  House,
  Info,
  Layers,
  Link,
  Package,
  PackageOpen,
  PackagePlus,
  Pencil,
  ShoppingBasket,
  SquarePlus,
  Trash,
  Undo2,
  UserPlus,
  Users,
  Vibrate,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { CategoryKey } from '@/domain/types';
import { type ProductFacts, ProductFactsSections } from '@/features/product-facts';
import { HapticsHost, isHapticsEnabled, setHapticsEnabled } from '@/shared/lib/haptics';
import {
  AvatarButton,
  BackButton,
  Button,
  CATEGORY_HUES,
  Card,
  type CategoryHue,
  type CategoryIconName,
  CategoryPicker,
  CategoryTile,
  ChipGroup,
  ColorSwatchPicker,
  ConfirmDialog,
  CountBadge,
  categoryVisual,
  DEFAULT_CATEGORY_VISUALS,
  EmptyState,
  ForecastBadge,
  GroceryRow,
  IconButton,
  IconPicker,
  InstallStep,
  InviteCodeDisplay,
  ItemRow,
  LargeTitleHeader,
  ListRow,
  ListSection,
  NavBar,
  OptionCard,
  PantrySwitcher,
  PullSpinner,
  QuantityNumber,
  QuantityStepper,
  Reticle,
  type ReticleTone,
  RunningLowMarker,
  ScanButton,
  type ScanMode,
  ScannerCover,
  ScreenStack,
  SearchField,
  SegmentedControl,
  Sheet,
  SheetTextButton,
  SkeletonRow,
  Spinner,
  type StackScreen,
  StatusBanner,
  SwipeActions,
  Switch,
  SyncDot,
  SyncIndicator,
  type SyncState,
  TabBar,
  TextField,
  Toast,
  type ToastData,
  Wordmark,
} from '@/shared/ui';

type Theme = 'system' | 'light' | 'dark';

const CATEGORY_NAMES: Record<CategoryKey, string> = {
  legumes: 'Légumes',
  fruits: 'Fruits',
  feculents: 'Pâtes, riz & céréales',
  poisson: 'Poisson',
  viande: 'Viande & charcuterie',
  laitier: 'Produits laitiers & œufs',
  pain: 'Pain & viennoiseries',
  apero: 'Apéritifs & snacks salés',
  epicerie_sucree: 'Épicerie sucrée',
  chocolat: 'Chocolat & confiserie',
  petit_dej: 'Petit-déjeuner & tartinables',
  conserves: 'Conserves',
  surgeles: 'Surgelés',
  plats: 'Plats préparés & soupes',
  soft: 'Boissons sans alcool',
  jus: 'Jus & nectars',
  eau: 'Eaux',
  vin: 'Vins',
  biere: 'Bières, cidres & spiritueux',
  cafe: 'Café & thé',
  condiments: 'Condiments, sauces & huiles',
  bebe: 'Bébé',
  animaux: 'Animaux',
  entretien: 'Entretien & nettoyage',
  hygiene: 'Hygiène & beauté',
  papier: 'Papier & jetables',
  pharmacie: 'Pharmacie & compléments',
  autre: 'Autre',
};

const HUE_LABELS: Record<CategoryHue, string> = {
  tomato: 'Tomate',
  clay: 'Argile',
  apricot: 'Abricot',
  honey: 'Miel',
  olive: 'Olive',
  sage: 'Sauge',
  teal: 'Sarcelle',
  sky: 'Ciel',
  iris: 'Iris',
  plum: 'Prune',
  rose: 'Rose',
  pebble: 'Galet',
};

const CATEGORIES = (Object.keys(DEFAULT_CATEGORY_VISUALS) as CategoryKey[]).map((key) => ({
  id: key,
  name: CATEGORY_NAMES[key],
  visual: categoryVisual({ templateKey: key }),
}));

const TABS = [
  { key: 'home', label: 'Accueil', icon: House, href: '#accueil' },
  { key: 'stock', label: 'Stock', icon: Package, href: '#stock' },
  { key: 'courses', label: 'Courses', icon: ShoppingBasket, href: '#courses' },
] as const;

const SYNC_STATES: Array<{ state: SyncState; text: string }> = [
  { state: 'firstSync', text: 'Chargement du foyer…' },
  { state: 'pending', text: '2 modifications en attente' },
  { state: 'offline', text: 'Hors ligne' },
  { state: 'offlinePending', text: 'Hors ligne · 1 modification en attente' },
  { state: 'error', text: 'Synchronisation interrompue' },
  { state: 'attention', text: '3 à vérifier' },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pt-8">
      <h2 className="px-4 type-title-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 px-4">{children}</div>;
}

const GALLERY_FOOD_FACTS: ProductFacts = {
  gtin: '03017620422003',
  found: true,
  source: 'off',
  nutriscore: 'e',
  nova: 3,
  ecoscore: 'f',
  nutriments: {
    energy_kcal: 539,
    fat: 30.9,
    saturated_fat: 10.6,
    carbohydrates: 57.5,
    sugars: 56.3,
    fiber: 0,
    proteins: 6.3,
    salt: 0.107,
  },
  levels: { fat: 'high', saturated_fat: 'high', sugars: 'high', salt: 'low' },
  ingredients:
    'Sucre, huile de palme, NOISETTES 13%, cacao maigre 7,4%, LAIT écrémé en poudre 6,6%, LACTOSERUM en poudre, émulsifiants : lécithines [SOJA], vanilline. Sans gluten.',
  allergens: ['en:milk', 'en:nuts', 'en:soybeans'],
  traces: [],
  additives: ['E322'],
  labels: ['en:vegetarian', 'en:no-gluten', 'fr:triman'],
  analysis: ['en:palm-oil', 'en:vegetarian'],
  origins: null,
  afterOpeningMonths: null,
  fetchedAt: '2026-11-11T00:00:00Z',
};

const GALLERY_BEAUTY_FACTS: ProductFacts = {
  ...GALLERY_FOOD_FACTS,
  gtin: '03337875598996',
  source: 'obf',
  nutriscore: null,
  nova: null,
  ecoscore: null,
  nutriments: {},
  levels: {},
  ingredients:
    'Eau, glycérine, alcool cétéarylique, triglycéride caprylique/caprique, alcool cétylique, céteareth-20, vaseline, phosphate de potassium, céramide NP, céramide AP, céramide EOP, carbomère, diméthicone, méthosulfate de béhentrimonium, lauryllactylate de sodium, hyaluronate de sodium, cholestérol, phénoxyéthanol, gomme xanthane, éthylhexylglycérine.',
  allergens: [],
  additives: [],
  labels: ['en:without-perfume'],
  analysis: [],
  origins: 'France',
  afterOpeningMonths: 12,
};

export function UiGalleryPage() {
  const [theme, setTheme] = useState<Theme>('system');
  const [reducedTransparency, setReducedTransparency] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('stock');
  const [toggle, setToggle] = useState(true);
  const [haptics, setHaptics] = useState(isHapticsEnabled);
  const [qty, setQty] = useState(3);
  const [bigQty, setBigQty] = useState(1);
  const [rowQty, setRowQty] = useState(6);
  const [mode, setMode] = useState<'add' | 'withdraw'>('add');
  const [sort, setSort] = useState<'nom' | 'categorie' | 'recent'>('nom');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>('vin');
  const [icon, setIcon] = useState<CategoryIconName>('wine');
  const [hue, setHue] = useState<CategoryHue>('plum');
  const [checked, setChecked] = useState(false);
  const [chips, setChips] = useState<string[]>(['cave']);
  const [name, setName] = useState('Côtes-du-Rhône');
  const [price, setPrice] = useState('6,90');
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<null | 'fit' | 'detents' | 'large' | 'nested'>(null);
  const [childSheet, setChildSheet] = useState(false);
  const [dirtyName, setDirtyName] = useState('');
  const [confirm, setConfirm] = useState<null | 'destructive' | 'discard'>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [cover, setCover] = useState<{ mode: ScanMode; rect: DOMRect } | null>(null);
  const [scans, setScans] = useState(0);
  const [tone, setTone] = useState<ReticleTone>('idle');
  const [stackDepth, setStackDepth] = useState(1);
  const [low, setLow] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const root = document.documentElement;
    if (reducedTransparency) root.dataset.transparency = 'reduced';
    else delete root.dataset.transparency;
  }, [reducedTransparency]);
  useEffect(() => {
    if (tone === 'idle') return;
    const id = setTimeout(() => setTone('idle'), 600);
    return () => clearTimeout(id);
  }, [tone]);

  let toastCount = 0;
  const showToast = (withAction: boolean) => {
    toastCount += 1;
    setToast({
      id: `${Date.now()}-${toastCount}`,
      message: withAction ? '3 articles ajoutés à Cave' : 'Liste de courses mise à jour',
      icon: withAction ? PackagePlus : CircleCheck,
      action: withAction ? { label: 'Annuler', onPress: () => setQty(3) } : undefined,
    });
  };

  const stackScreens: StackScreen[] = Array.from({ length: stackDepth }, (_, i) => ({
    key: `screen-${i}`,
    element: (
      <div className="flex min-h-full flex-col">
        <NavBar
          title={i === 0 ? 'Stock' : `Écran ${i + 1}`}
          leading={
            i > 0 ? (
              <BackButton
                previousTitle={i === 1 ? 'Stock' : `Écran ${i}`}
                fallbackLabel="Retour"
                accessibleLabel="Retour"
                onPress={() => setStackDepth((d) => Math.max(1, d - 1))}
              />
            ) : null
          }
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
          <p className="type-subhead text-label-secondary">Profondeur {i + 1}</p>
          <Button size="medium" onClick={() => setStackDepth((d) => d + 1)}>
            Pousser un écran
          </Button>
        </div>
      </div>
    ),
  }));

  const wineVisual = categoryVisual({ templateKey: 'vin' });
  const milkVisual = categoryVisual({ templateKey: 'laitier' });
  const pastaVisual = categoryVisual({ templateKey: 'feculents' });

  return (
    <main className="min-h-dvh bg-bg-grouped pb-(--content-bottom) text-label-primary">
      <HapticsHost />
      <LargeTitleHeader
        title={
          <PantrySwitcher
            name="Cave"
            interactive
            onPress={() => setSheet('fit')}
            accessibleLabel="Cellier : Cave"
            hint="Changer de cellier"
          />
        }
        compactTitle="Cave"
        trailing={<AvatarButton initials="AF" label="Réglages" onPress={() => setSheet('large')} />}
        subtitle={
          <SyncIndicator
            state="offlinePending"
            text="Hors ligne · 2 modifications en attente"
            accessibleLabel="Hors ligne, ouvrir les détails"
            onPress={() => showToast(false)}
          />
        }
        search={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Rechercher dans le stock"
            cancelLabel="Annuler"
            clearLabel="Effacer"
          />
        }
      />

      <Block title="Apparence">
        <Row>
          <SegmentedControl
            label="Thème"
            className="w-full"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Système' },
              { value: 'light', label: 'Clair' },
              { value: 'dark', label: 'Sombre' },
            ]}
          />
        </Row>
        <ListSection>
          <ListRow
            variant="toggle"
            title="Réduire la transparence"
            trailing={
              <Switch
                checked={reducedTransparency}
                onCheckedChange={setReducedTransparency}
                label="Réduire la transparence"
              />
            }
          />
          <ListRow
            variant="toggle"
            title="Retours haptiques"
            leading={<CategoryTile icon={Vibrate} hue="pebble" size={28} />}
            trailing={
              <Switch
                checked={haptics}
                onCheckedChange={(v) => {
                  setHaptics(v);
                  setHapticsEnabled(v);
                }}
                label="Retours haptiques"
              />
            }
          />
        </ListSection>
      </Block>

      <Block title="Boutons">
        <div className="flex flex-col gap-3 px-4">
          <Button fullWidth onClick={() => showToast(true)}>
            Ajouter au stock
          </Button>
          <Button
            fullWidth
            variant="secondary"
            onClick={() =>
              setToast({
                id: `update-${Date.now()}`,
                message: 'Nouvelle version disponible',
                action: { label: 'Recharger', onPress: () => undefined },
                persistent: true,
              })
            }
          >
            Toast persistant
          </Button>
          <Button fullWidth variant="secondary" icon={Pencil}>
            Modifier
          </Button>
          <Button fullWidth variant="destructive" onClick={() => setConfirm('destructive')}>
            Supprimer le cellier
          </Button>
          <div className="flex gap-3">
            <Button fullWidth loading loadingLabel="Chargement">
              Envoyer
            </Button>
            <Button fullWidth disabled>
              Désactivé
            </Button>
          </div>
        </div>
        <Row>
          <Button variant="plain" size="medium">
            Tout voir
          </Button>
          <Button variant="destructive-plain" size="medium">
            Retirer
          </Button>
          <Button variant="secondary" size="small">
            Petit
          </Button>
          <IconButton icon={ArrowUpDown} label="Trier" />
          <IconButton icon={Undo2} label="Annuler" tone="secondary" filled />
          <IconButton icon={Trash} label="Supprimer" tone="danger" />
          <IconButton icon={Pencil} label="Désactivé" disabled />
        </Row>
      </Block>

      <Block title="Listes">
        <ListSection header="Foyer" footer="Les membres partagent le même stock.">
          <ListRow
            title="Membres"
            leading={<CategoryTile icon={Users} hue="sky" size={28} />}
            value="3"
            onPress={() => {}}
          />
          <ListRow title="Inviter" leading={<CategoryTile icon={UserPlus} hue="sage" size={28} />} onPress={() => {}} />
          <ListRow
            title="Celliers"
            leading={<CategoryTile icon={Layers} hue="clay" size={28} />}
            value="Cave, Cuisine"
            onPress={() => {}}
          />
          <ListRow
            variant="toggle"
            title="Alertes de stock"
            leading={<CategoryTile icon={Bell} hue="honey" size={28} />}
            trailing={<Switch checked={toggle} onCheckedChange={setToggle} label="Alertes de stock" />}
          />
        </ListSection>
        <ListSection>
          <ListRow variant="button" title="Nouvelle catégorie" onPress={() => {}} />
          <ListRow variant="value" title="Trier par" value="Nom" />
          <ListRow variant="plain" title="Sélectionné" selected />
          <ListRow variant="navigation" title="Désactivé" disabled onPress={() => {}} />
          <ListRow variant="destructive" title="Quitter le foyer" onPress={() => setConfirm('destructive')} />
        </ListSection>
      </Block>

      <Block title="Informations produit">
        <ProductFactsSections facts={GALLERY_FOOD_FACTS} netUnit="g" />
        <ProductFactsSections facts={GALLERY_BEAUTY_FACTS} netUnit="ml" />
      </Block>

      <Block title="Articles">
        <ListSection header="Stock · glisser pour ±1">
          <SwipeActions
            leading={[
              { label: '+1', accessibleLabel: 'Ajouter 1', tone: 'accent', onAction: () => setRowQty((q) => q + 1) },
            ]}
            trailing={[
              {
                label: '−1',
                accessibleLabel: 'Retirer 1',
                tone: 'warning',
                onAction: () => setRowQty((q) => Math.max(0, q - 1)),
              },
              {
                label: 'Suppr.',
                accessibleLabel: 'Supprimer',
                icon: Trash,
                tone: 'danger',
                onAction: () => showToast(true),
              },
            ]}
          >
            <ItemRow
              name="Côtes-du-Rhône rouge"
              secondary="Domaine de la Janasse · 75 cl"
              visual={wineVisual}
              quantity={rowQty}
              unit="bt"
              low={rowQty <= 2}
              accessibleLabel={`Côtes-du-Rhône rouge, ${rowQty} en stock`}
              onPress={() => setRowQty((q) => q + 1)}
            />
          </SwipeActions>
          <SwipeActions
            leading={[{ label: '+1', tone: 'accent', onAction: () => {} }]}
            trailing={[{ label: '−1', tone: 'warning', onAction: () => {} }]}
          >
            <ItemRow
              name="Lait demi-écrémé"
              secondary="Lactel · 1 L"
              visual={milkVisual}
              quantity={1}
              low
              pending
              accessibleLabel="Lait demi-écrémé, 1 en stock, bientôt épuisé"
              onPress={() => {}}
            />
          </SwipeActions>
          <ItemRow
            name="Spaghetti n° 5"
            secondary="Épuisé"
            visual={pastaVisual}
            quantity={0}
            low
            accessibleLabel="Spaghetti, 0 en stock, bientôt épuisé"
            onPress={() => {}}
          />
        </ListSection>
        <ListSection header="Bientôt épuisé">
          <ItemRow
            variant="low"
            name="Café en grains"
            secondary="Reste 1"
            visual={categoryVisual({ templateKey: 'cafe' })}
            quantity={1}
            trailing={<ForecastBadge label="≈ 4 j" accessibleLabel="Environ 4 jours de stock" />}
            accessibleLabel="Café en grains, reste 1, environ 4 jours de stock"
            onPress={() => {}}
          />
          <ItemRow
            variant="low"
            name="Eau gazeuse"
            secondary="Reste 0"
            visual={categoryVisual({ templateKey: 'eau' })}
            quantity={0}
            trailing={<ForecastBadge label="Épuisé" />}
            accessibleLabel="Eau gazeuse, épuisé"
            onPress={() => {}}
          />
          <ItemRow
            variant="compact"
            name="Résultat de recherche"
            secondary="Compact, 52 px"
            visual={wineVisual}
            quantity={12}
            accessibleLabel="Résultat de recherche"
            onPress={() => {}}
          />
          <SkeletonRow />
        </ListSection>
        <ListSection header="Courses">
          <GroceryRow
            name="Lait demi-écrémé"
            reason="Sous le minimum"
            visual={milkVisual}
            quantityLabel="× 3"
            checked={checked}
            onCheckedChange={setChecked}
            checkLabel="Lait demi-écrémé, 3"
            onPress={() => {}}
          />
          <GroceryRow
            name="Café en grains"
            reason="Épuisé vers le 18 nov."
            visual={categoryVisual({ templateKey: 'cafe' })}
            quantityLabel="× 1"
            checked
            onCheckedChange={() => {}}
            checkLabel="Café en grains, 1"
          />
        </ListSection>
      </Block>

      <Block title="Quantités">
        <Row>
          <QuantityStepper
            value={qty}
            onChange={setQty}
            label="Quantité"
            decrementLabel="Retirer 1"
            incrementLabel="Ajouter 1"
            editLabel="Saisir la quantité"
          />
          <QuantityStepper
            value={bigQty}
            onChange={setBigQty}
            min={1}
            size="large"
            label="Quantité"
            decrementLabel="Retirer 1"
            incrementLabel="Ajouter 1"
            editLabel="Saisir la quantité"
          />
        </Row>
        <Row>
          <QuantityNumber value={rowQty} unit="bt" />
          <Button size="small" variant="secondary" onClick={() => setRowQty((q) => q + 1)}>
            Pop +1
          </Button>
          <ForecastBadge label="≈ 2 sem." />
          <ForecastBadge label="Seuil" tone="neutral" />
          <CountBadge>× 3</CountBadge>
          <CountBadge size="small" tone="accent">
            7
          </CountBadge>
          <RunningLowMarker visible={low} />
          <Button size="small" variant="secondary" onClick={() => setLow((v) => !v)}>
            Bascule bas
          </Button>
          <SyncDot label="En attente" />
          <Spinner label="Chargement" />
          <PullSpinner progress={0.5} />
        </Row>
      </Block>

      <Block title="Contrôles">
        <Row>
          <SegmentedControl
            label="Trier par"
            className="w-full"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'nom', label: 'Nom' },
              { value: 'categorie', label: 'Catégorie' },
              { value: 'recent', label: 'Récent' },
            ]}
          />
        </Row>
        <div className="mx-4 rounded-md bg-scanner-bg p-3">
          <SegmentedControl
            label="Mode"
            variant="scanner"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'add', label: 'Ajouter' },
              { value: 'withdraw', label: 'Retirer' },
            ]}
          />
        </div>
        <Row>
          <ChipGroup
            label="Suggestions"
            options={[
              { value: 'cave', label: 'Cave' },
              { value: 'cuisine', label: 'Cuisine' },
              { value: 'garage', label: 'Garage' },
            ]}
            selected={chips}
            onToggle={(v) => setChips((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]))}
          />
        </Row>
        <ListSection header="Champs">
          <TextField
            label="Nom"
            value={name}
            onChange={setName}
            override={
              name !== 'Côtes-du-Rhône'
                ? undefined
                : { modifiedLabel: 'Modifié', resetLabel: 'Rétablir', onReset: () => setName('Côtes du Rhône') }
            }
          />
          <TextField label="Prix" value={price} onChange={setPrice} inputMode="decimal" unit="€" />
          <TextField
            label="Contenance"
            value=""
            onChange={() => {}}
            inputMode="numeric"
            unit="cl"
            error="Saisir un nombre."
          />
        </ListSection>
      </Block>

      <Block title="Catégories">
        <div className="grid grid-cols-7 gap-2 px-4">
          {CATEGORIES.map((c) => (
            <CategoryTile key={c.id} visual={c.visual} size={36} label={c.name} />
          ))}
        </div>
        <Row>
          <CategoryTile visual={wineVisual} size={30} />
          <CategoryTile visual={wineVisual} size={56} />
          <CategoryTile visual={categoryVisual({ templateKey: 'vin', icon, color: hue })} size={64} />
        </Row>
        <CategoryPicker
          categories={CATEGORIES.slice(0, 12)}
          value={category}
          onChange={setCategory}
          label="Catégorie"
        />
        <IconPicker value={icon} onChange={setIcon} hue={hue} label="Icône" />
        <ColorSwatchPicker value={hue} onChange={setHue} hueLabels={HUE_LABELS} label="Couleur" />
        <p className="px-4 type-footnote text-label-secondary">{CATEGORY_HUES.length} teintes</p>
      </Block>

      <Block title="États">
        <div className="flex flex-col gap-1">
          {SYNC_STATES.map((s) => (
            <SyncIndicator
              key={s.state}
              state={s.state}
              text={s.text}
              accessibleLabel={s.text}
              onPress={() => {}}
              retry={
                s.state === 'error'
                  ? { label: 'Réessayer', accessibleLabel: 'Réessayer la synchronisation', onPress: () => {} }
                  : undefined
              }
            />
          ))}
        </div>
        <StatusBanner
          icon={Info}
          text="Installer Cellier sur l’écran d’accueil."
          action={{ label: 'Voir', onPress: () => setSheet('fit') }}
          dismissLabel="Masquer"
          onDismiss={() => {}}
        />
        <StatusBanner icon={CloudOff} tone="warning" text="Notifications refusées." />
        <Card title="Prochaines courses" headerAction={{ label: 'Tout voir', onPress: () => {} }}>
          <p className="type-subhead text-label-secondary">Samedi 16 nov. · 7 articles</p>
        </Card>
        <div className="py-6">
          <EmptyState
            icon={PackageOpen}
            title="Le stock est vide"
            body="Scanner un produit pour commencer."
            action={{ label: 'Scanner un produit', onPress: () => {} }}
            secondaryAction={{ label: 'Saisir à la main', onPress: () => {} }}
          />
        </div>
      </Block>

      <Block title="Onboarding">
        <div className="flex flex-col items-center gap-4 px-4">
          <Wordmark>Cellier</Wordmark>
          <OptionCard
            icon={SquarePlus}
            title="Créer un foyer"
            subtitle="Pour commencer un inventaire"
            onPress={() => {}}
          />
          <OptionCard icon={Link} title="Rejoindre un foyer" subtitle="Avec un code d’invitation" onPress={() => {}} />
          <ol className="w-full">
            <InstallStep index={1} text="Toucher « Partager »" />
            <InstallStep index={2} text="Sur l’écran d’accueil" icon={SquarePlus} />
          </ol>
          <InviteCodeDisplay
            code="K7Q2-M9XP"
            accessibleLabel="K 7 Q 2 M 9 X P"
            copied={copied}
            onCopy={() => setCopied(true)}
            copyLabel="Copier"
            copiedLabel="Copié"
            onShare={() => {}}
            shareLabel="Partager"
          />
        </div>
      </Block>

      <Block title="Surfaces">
        <div className="grid grid-cols-2 gap-3 px-4">
          <Button variant="secondary" size="medium" onClick={() => setSheet('fit')}>
            Sheet fit
          </Button>
          <Button variant="secondary" size="medium" onClick={() => setSheet('detents')}>
            Medium + large
          </Button>
          <Button variant="secondary" size="medium" onClick={() => setSheet('large')}>
            Large + pied
          </Button>
          <Button variant="secondary" size="medium" onClick={() => setSheet('nested')}>
            Empilées
          </Button>
          <Button variant="secondary" size="medium" onClick={() => showToast(true)}>
            Toast + action
          </Button>
          <Button variant="secondary" size="medium" onClick={() => showToast(false)}>
            Toast simple
          </Button>
          <Button variant="secondary" size="medium" onClick={() => setConfirm('discard')}>
            Confirmation
          </Button>
        </div>
        <div className="relative mx-4 flex h-[420px] overflow-hidden rounded-lg border border-separator">
          <ScreenStack screens={stackScreens} edgeSwipe onBack={() => setStackDepth((d) => Math.max(1, d - 1))} />
        </div>
      </Block>

      <Sheet open={sheet === 'fit'} onOpenChange={(o) => !o && setSheet(null)} title="Celliers" closeLabel="Fermer">
        <ListSection>
          <ListRow variant="plain" title="Cave" selected />
          <ListRow variant="navigation" title="Cuisine" onPress={() => setSheet(null)} />
          <ListRow variant="button" title="Nouveau cellier" onPress={() => {}} />
        </ListSection>
      </Sheet>

      <Sheet
        open={sheet === 'detents'}
        onOpenChange={(o) => !o && setSheet(null)}
        detents={['medium', 'large']}
        title="Catégorie"
        closeLabel="Fermer"
      >
        <div className="flex flex-col gap-4 pb-4">
          <div className="px-4">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Rechercher"
              cancelLabel="Annuler"
              clearLabel="Effacer"
            />
          </div>
          <CategoryPicker categories={CATEGORIES} value={category} onChange={setCategory} label="Catégorie" />
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'large'}
        onOpenChange={(o) => !o && setSheet(null)}
        detents={['large']}
        title="Modifier l’article"
        leading={<SheetTextButton onPress={() => setSheet(null)}>Annuler</SheetTextButton>}
        trailing={
          <SheetTextButton emphasis onPress={() => setSheet(null)} disabled={dirtyName.length === 0}>
            Enregistrer
          </SheetTextButton>
        }
        dirty={dirtyName.length > 0}
        onDismissBlocked={() => setConfirm('discard')}
        closeLabel="Fermer"
        footer={
          <Button fullWidth onClick={() => setSheet(null)}>
            Ajouter au stock
          </Button>
        }
      >
        <div className="flex flex-col gap-8 pt-2">
          <ListSection footer="Saisir un nom rend la feuille « modifiée » : glisser vers le bas demande confirmation.">
            <TextField label="Nom" value={dirtyName} onChange={setDirtyName} placeholder="Nom du produit" />
            <TextField label="Prix" value={price} onChange={setPrice} inputMode="decimal" unit="€" />
          </ListSection>
          {['Section 1', 'Section 2', 'Section 3', 'Section 4'].map((h) => (
            <ListSection key={h} header={h}>
              <ListRow title="Ligne" value="Valeur" onPress={() => {}} />
              <ListRow title="Autre ligne" onPress={() => {}} />
            </ListSection>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'nested'}
        onOpenChange={(o) => !o && setSheet(null)}
        detents={['large']}
        title="Modifier"
        closeLabel="Fermer"
      >
        <div className="flex flex-col gap-4 px-4 pt-2">
          <Button onClick={() => setChildSheet(true)}>Choisir une catégorie</Button>
        </div>
        <Sheet
          open={childSheet}
          onOpenChange={setChildSheet}
          detents={['medium', 'large']}
          title="Catégorie"
          closeLabel="Fermer"
        >
          <CategoryPicker
            categories={CATEGORIES}
            value={category}
            onChange={(id) => {
              setCategory(id);
              setChildSheet(false);
            }}
            label="Catégorie"
          />
        </Sheet>
      </Sheet>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'discard' ? 'Abandonner les modifications ?' : 'Supprimer « Cave » ?'}
        message={confirm === 'discard' ? undefined : 'Ses 42 articles seront supprimés.'}
        actions={[
          {
            label: confirm === 'discard' ? 'Abandonner' : 'Supprimer',
            destructive: true,
            onPress: () => {
              setConfirm(null);
              if (confirm === 'discard') {
                setDirtyName('');
                setSheet(null);
              }
            },
          },
        ]}
        cancelLabel="Annuler"
      />

      <Toast toast={toast} onDismiss={(id) => setToast((t) => (t?.id === id ? null : t))} />

      <ScannerCover
        open={cover !== null}
        onClose={() => setCover(null)}
        originRect={cover?.rect ?? null}
        label="Scanner"
      >
        <div className="flex h-full flex-col pt-[calc(var(--safe-top)+8px)] pb-[calc(var(--safe-bottom)+16px)]">
          <div className="flex items-center justify-between gap-3 px-2">
            <IconButton icon={X} label="Fermer" tone="on-dark" onClick={() => setCover(null)} />
            <SegmentedControl
              label="Mode"
              variant="scanner"
              className="w-56"
              value={cover?.mode ?? 'add'}
              onChange={(m) => setCover((c) => (c ? { ...c, mode: m } : c))}
              options={[
                { value: 'add', label: 'Ajouter' },
                { value: 'withdraw', label: 'Retirer' },
              ]}
            />
            <span className="size-11" />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <Reticle successCount={scans} tone={tone} />
          </div>
          <div className="flex flex-col gap-3 px-4">
            <div className="flex gap-3">
              <Button
                fullWidth
                variant="secondary"
                onClick={() => {
                  setScans((s) => s + 1);
                  setTone('success');
                }}
              >
                Simuler un scan
              </Button>
              <Button fullWidth variant="secondary" onClick={() => setTone('unknown')}>
                Inconnu
              </Button>
            </div>
            <Button fullWidth onClick={() => setCover(null)}>
              Terminer
            </Button>
          </div>
        </div>
      </ScannerCover>

      <TabBar
        label="Navigation principale"
        items={TABS}
        active={tab}
        onSelect={(key, e) => {
          e.preventDefault();
          setTab(key);
        }}
        scanButton={
          <ScanButton
            label="Scanner des produits"
            hint="Maintenir pour retirer des produits"
            onScan={(m, rect) => setCover({ mode: m, rect })}
          />
        }
      />
    </main>
  );
}
