import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { env } from '@core/config/env';
import { createAppContainer } from '@core/container';
import { TOKENS } from '@core/container/tokens';
import { createDatabaseAdapter } from '@core/database';
import { logger } from '@core/logger/logger';
import { registerModules } from '@core/module';
import { RedisConnection } from '@core/redis/redis.client';
import { authModule } from '@modules/auth/auth.module';
import { AUTH_REPOSITORY } from '@modules/auth/auth.repository';
import { PasswordService } from '@modules/auth/password.service';
import { catalogModule } from '@modules/catalog/catalog.module';
import { CATALOG_REPOSITORY } from '@modules/catalog/catalog.repository';
import type { CatalogRepository, NewVariant } from '@modules/catalog/catalog.repository';
import { registerSharedServices } from '@shared/index';
import { notificationModule } from '@shared/notifications/notification.module';

/**
 * Fills an empty database with a shop somebody could actually browse: a category tree, fifty
 * products with real variants and real stock, an administrator and a customer to sign in as.
 *
 * Written against the repositories rather than against Prisma, so the seed exercises the same
 * contract the server does — a seed that reaches past the repository is a seed that keeps
 * working after the repository stops being correct.
 *
 *   pnpm db:seed
 */

const CURRENCY = 'XOF';
const DEMO_PASSWORD = 'Seed!Passw0rd';

interface CategorySeed {
  slug: string;
  name: string;
  description: string;
}

interface VariantSeed {
  name: string;
  priceCents?: number;
  stock: number;
  attributes: Record<string, string>;
  weightGrams?: number;
}

interface ProductSeed {
  category: string;
  slug: string;
  name: string;
  brand: string | null;
  description: string;
  basePriceCents: number;
  variants: VariantSeed[];
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: 'telephonie',
    name: 'Téléphonie',
    description: 'Smartphones, accessoires et forfaits data.',
  },
  {
    slug: 'informatique',
    name: 'Informatique',
    description: 'Ordinateurs portables, périphériques et stockage.',
  },
  {
    slug: 'energie',
    name: 'Énergie',
    description: 'Solaire, batteries et onduleurs pour les coupures.',
  },
  { slug: 'maison', name: 'Maison', description: 'Électroménager et confort du quotidien.' },
  { slug: 'mode', name: 'Mode', description: 'Prêt-à-porter, pagne et accessoires.' },
  { slug: 'epicerie', name: 'Épicerie', description: 'Produits locaux, sec et conditionné.' },
];

const SIZES = ['S', 'M', 'L', 'XL'];

/** Colour axes reused across the wearable products so the variant grid looks like a real one. */
const COLOURS = ['Noir', 'Blanc', 'Bleu', 'Indigo'];

function storage(name: string, gb: number, price: number, stock: number): VariantSeed {
  return { name, priceCents: price, stock, attributes: { stockage: `${String(gb)} Go` } };
}

function sized(colour: string, stock: number, weight: number): VariantSeed[] {
  return SIZES.map((size) => ({
    name: `${colour} / ${size}`,
    stock,
    attributes: { couleur: colour, taille: size },
    weightGrams: weight,
  }));
}

function single(stock: number, weight?: number): VariantSeed[] {
  return [
    {
      name: 'Standard',
      stock,
      attributes: {},
      ...(weight === undefined ? {} : { weightGrams: weight }),
    },
  ];
}

const PRODUCTS: ProductSeed[] = [
  {
    category: 'telephonie',
    slug: 'smartphone-atlas-a5',
    name: 'Smartphone Atlas A5',
    brand: 'Atlas',
    description:
      "Écran 6,5 pouces, double SIM et batterie 5000 mAh : deux jours d'autonomie en usage courant.",
    basePriceCents: 12_900_000,
    variants: [
      storage('64 Go', 64, 12_900_000, 40),
      storage('128 Go', 128, 15_400_000, 25),
      storage('256 Go', 256, 18_900_000, 8),
    ],
  },
  {
    category: 'telephonie',
    slug: 'smartphone-atlas-a9-pro',
    name: 'Smartphone Atlas A9 Pro',
    brand: 'Atlas',
    description: 'Triple capteur 64 Mpx, charge rapide 33 W et châssis aluminium.',
    basePriceCents: 24_500_000,
    variants: [storage('128 Go', 128, 24_500_000, 15), storage('256 Go', 256, 28_000_000, 6)],
  },
  {
    category: 'telephonie',
    slug: 'telephone-basique-kora-k1',
    name: 'Téléphone basique Kora K1',
    brand: 'Kora',
    description: 'Touches physiques, lampe torche et radio FM. Trois semaines sans recharge.',
    basePriceCents: 1_250_000,
    variants: single(220, 90),
  },
  {
    category: 'telephonie',
    slug: 'ecouteurs-sans-fil-vibe-x',
    name: 'Écouteurs sans fil Vibe X',
    brand: 'Vibe',
    description: 'Bluetooth 5.3, réduction de bruit et boîtier de charge 24 heures.',
    basePriceCents: 3_200_000,
    variants: [
      { name: 'Noir', priceCents: 3_200_000, stock: 60, attributes: { couleur: 'Noir' } },
      { name: 'Blanc', priceCents: 3_200_000, stock: 45, attributes: { couleur: 'Blanc' } },
    ],
  },
  {
    category: 'telephonie',
    slug: 'chargeur-rapide-33w',
    name: 'Chargeur rapide 33 W',
    brand: 'Atlas',
    description: 'USB-C Power Delivery, protection contre les surtensions du réseau.',
    basePriceCents: 850_000,
    variants: single(180, 120),
  },
  {
    category: 'telephonie',
    slug: 'coque-antichoc-atlas-a5',
    name: 'Coque antichoc Atlas A5',
    brand: null,
    description: 'Silicone renforcé aux angles, découpes précises pour les deux SIM.',
    basePriceCents: 350_000,
    variants: [
      { name: 'Transparente', stock: 120, attributes: { couleur: 'Transparente' } },
      { name: 'Noire', stock: 95, attributes: { couleur: 'Noir' } },
    ],
  },
  {
    category: 'telephonie',
    slug: 'verre-trempe-universel',
    name: 'Verre trempé universel',
    brand: null,
    description: 'Dureté 9H, kit de pose inclus. Se découpe pour la plupart des écrans 6 pouces.',
    basePriceCents: 200_000,
    variants: single(300, 40),
  },
  {
    category: 'telephonie',
    slug: 'powerbank-20000-mah',
    name: 'Powerbank 20 000 mAh',
    brand: 'Vibe',
    description: 'Deux sorties USB, charge un smartphone quatre fois. Indicateur à LED.',
    basePriceCents: 2_400_000,
    variants: single(70, 420),
  },
  {
    category: 'telephonie',
    slug: 'support-voiture-magnetique',
    name: 'Support voiture magnétique',
    brand: null,
    description: "Aimants néodyme, fixation grille d'aération. Tient sur route dégradée.",
    basePriceCents: 600_000,
    variants: single(85, 110),
  },
  {
    category: 'telephonie',
    slug: 'cable-usb-c-tresse-2m',
    name: 'Câble USB-C tressé 2 m',
    brand: null,
    description: 'Gaine nylon, connecteurs métal. Supporte 60 W.',
    basePriceCents: 300_000,
    variants: single(260, 80),
  },

  {
    category: 'informatique',
    slug: 'ordinateur-portable-nova-14',
    name: 'Ordinateur portable Nova 14',
    brand: 'Nova',
    description: 'Ryzen 5, 16 Go de RAM, écran 14 pouces mat. Pensé pour le bureau et les cours.',
    basePriceCents: 48_000_000,
    variants: [
      storage('512 Go SSD', 512, 48_000_000, 12),
      storage('1 To SSD', 1024, 55_000_000, 5),
    ],
  },
  {
    category: 'informatique',
    slug: 'ordinateur-portable-nova-15-pro',
    name: 'Ordinateur portable Nova 15 Pro',
    brand: 'Nova',
    description: 'Core i7, 32 Go de RAM, dalle 15,6 pouces 120 Hz.',
    basePriceCents: 78_000_000,
    variants: [storage('1 To SSD', 1024, 78_000_000, 4)],
  },
  {
    category: 'informatique',
    slug: 'souris-sans-fil-silencieuse',
    name: 'Souris sans fil silencieuse',
    brand: 'Nova',
    description: 'Clics silencieux, dongle 2,4 GHz, une pile AA pour douze mois.',
    basePriceCents: 750_000,
    variants: single(140, 95),
  },
  {
    category: 'informatique',
    slug: 'clavier-azerty-mecanique',
    name: 'Clavier AZERTY mécanique',
    brand: 'Nova',
    description: 'Switches tactiles, rétroéclairage blanc, repose-poignets amovible.',
    basePriceCents: 2_800_000,
    variants: single(38, 980),
  },
  {
    category: 'informatique',
    slug: 'ecran-24-pouces-ips',
    name: 'Écran 24 pouces IPS',
    brand: 'Nova',
    description: 'Full HD, HDMI et VGA, pied réglable en hauteur.',
    basePriceCents: 14_500_000,
    variants: single(22, 3800),
  },
  {
    category: 'informatique',
    slug: 'disque-dur-externe-1-to',
    name: 'Disque dur externe 1 To',
    brand: 'Kora',
    description: 'USB 3.0, boîtier antichoc, sauvegarde automatique incluse.',
    basePriceCents: 4_500_000,
    variants: single(55, 210),
  },
  {
    category: 'informatique',
    slug: 'cle-usb-64-go',
    name: 'Clé USB 64 Go',
    brand: 'Kora',
    description: 'USB 3.2, capuchon rotatif, lecture 120 Mo/s.',
    basePriceCents: 700_000,
    variants: single(200, 15),
  },
  {
    category: 'informatique',
    slug: 'sacoche-ordinateur-15-pouces',
    name: 'Sacoche ordinateur 15 pouces',
    brand: null,
    description: 'Matelassée, poche avant pour chargeur et documents.',
    basePriceCents: 1_100_000,
    variants: [
      { name: 'Noire', stock: 65, attributes: { couleur: 'Noir' } },
      { name: 'Grise', stock: 40, attributes: { couleur: 'Gris' } },
    ],
  },
  {
    category: 'informatique',
    slug: 'imprimante-jet-encre-multifonction',
    name: "Imprimante jet d'encre multifonction",
    brand: 'Nova',
    description: 'Impression, scan et copie. Réservoirs rechargeables plutôt que cartouches.',
    basePriceCents: 16_800_000,
    variants: single(18, 5600),
  },
  {
    category: 'informatique',
    slug: 'routeur-wifi-6-double-bande',
    name: 'Routeur WiFi 6 double bande',
    brand: 'Kora',
    description: 'Quatre antennes, port WAN gigabit, contrôle parental intégré.',
    basePriceCents: 5_900_000,
    variants: single(33, 620),
  },

  {
    category: 'energie',
    slug: 'kit-solaire-100-w',
    name: 'Kit solaire 100 W',
    brand: 'Solaris',
    description:
      "Panneau, régulateur et deux ampoules. Assez pour l'éclairage et la recharge des téléphones.",
    basePriceCents: 18_500_000,
    variants: single(26, 8200),
  },
  {
    category: 'energie',
    slug: 'kit-solaire-300-w',
    name: 'Kit solaire 300 W',
    brand: 'Solaris',
    description: 'Trois panneaux, régulateur MPPT et câblage. Fait tourner un ventilateur la nuit.',
    basePriceCents: 46_000_000,
    variants: single(11, 22_000),
  },
  {
    category: 'energie',
    slug: 'batterie-gel-100-ah',
    name: 'Batterie gel 100 Ah',
    brand: 'Solaris',
    description: 'Sans entretien, tolère les cycles profonds. Garantie deux ans.',
    basePriceCents: 21_000_000,
    variants: single(14, 28_000),
  },
  {
    category: 'energie',
    slug: 'onduleur-1000-va',
    name: 'Onduleur 1000 VA',
    brand: 'Solaris',
    description: 'Bascule en 4 ms, protège un poste de travail complet pendant les coupures.',
    basePriceCents: 12_000_000,
    variants: single(20, 7400),
  },
  {
    category: 'energie',
    slug: 'lampe-solaire-portative',
    name: 'Lampe solaire portative',
    brand: 'Solaris',
    description: 'Trois intensités, port USB de secours, huit heures sur la position basse.',
    basePriceCents: 900_000,
    variants: single(150, 340),
  },
  {
    category: 'energie',
    slug: 'ventilateur-rechargeable-16-pouces',
    name: 'Ventilateur rechargeable 16 pouces',
    brand: 'Kora',
    description: 'Batterie intégrée, six heures sans courant, panneau solaire en option.',
    basePriceCents: 7_500_000,
    variants: single(30, 4200),
  },
  {
    category: 'energie',
    slug: 'regulateur-mppt-30-a',
    name: 'Régulateur MPPT 30 A',
    brand: 'Solaris',
    description: 'Écran LCD, protection inversion de polarité, compatible gel et lithium.',
    basePriceCents: 5_400_000,
    variants: single(24, 640),
  },
  {
    category: 'energie',
    slug: 'stabilisateur-de-tension-2000-w',
    name: 'Stabilisateur de tension 2000 W',
    brand: 'Solaris',
    description: 'Corrige les creux de tension qui abîment les moteurs et les compresseurs.',
    basePriceCents: 9_800_000,
    variants: single(16, 6100),
  },

  {
    category: 'maison',
    slug: 'ventilateur-sur-pied-18-pouces',
    name: 'Ventilateur sur pied 18 pouces',
    brand: 'Kora',
    description: 'Trois vitesses, oscillation large, hauteur réglable.',
    basePriceCents: 4_200_000,
    variants: single(48, 5300),
  },
  {
    category: 'maison',
    slug: 'refrigerateur-bar-90-l',
    name: 'Réfrigérateur bar 90 L',
    brand: 'Kora',
    description: 'Compresseur basse consommation, compartiment congélation, classe A+.',
    basePriceCents: 32_000_000,
    variants: single(9, 24_000),
  },
  {
    category: 'maison',
    slug: 'mixeur-blender-1-5-l',
    name: 'Mixeur blender 1,5 L',
    brand: 'Kora',
    description: 'Bol en verre, lames inox quatre branches, moteur 600 W.',
    basePriceCents: 3_500_000,
    variants: single(52, 2900),
  },
  {
    category: 'maison',
    slug: 'rechaud-a-gaz-deux-feux',
    name: 'Réchaud à gaz deux feux',
    brand: null,
    description: 'Grille fonte, allumage piézo, raccord détendeur standard.',
    basePriceCents: 2_900_000,
    variants: single(41, 4600),
  },
  {
    category: 'maison',
    slug: 'moustiquaire-impregnee-double',
    name: 'Moustiquaire imprégnée double',
    brand: null,
    description: 'Traitement longue durée, anneau de suspension et cordelettes fournis.',
    basePriceCents: 750_000,
    variants: single(160, 900),
  },
  {
    category: 'maison',
    slug: 'fer-a-repasser-vapeur',
    name: 'Fer à repasser vapeur',
    brand: 'Kora',
    description: 'Semelle céramique, jet vertical, arrêt automatique.',
    basePriceCents: 2_100_000,
    variants: single(58, 1400),
  },
  {
    category: 'maison',
    slug: 'set-casseroles-inox-5-pieces',
    name: 'Set casseroles inox 5 pièces',
    brand: null,
    description: 'Fond triple épaisseur, compatible tous feux, poignées rivetées.',
    basePriceCents: 6_400_000,
    variants: single(27, 4800),
  },
  {
    category: 'maison',
    slug: 'bouilloire-electrique-1-7-l',
    name: 'Bouilloire électrique 1,7 L',
    brand: 'Kora',
    description: 'Arrêt automatique, base rotative, filtre anticalcaire amovible.',
    basePriceCents: 1_600_000,
    variants: single(74, 1100),
  },
  {
    category: 'maison',
    slug: 'aspirateur-traineau-compact',
    name: 'Aspirateur traîneau compact',
    brand: 'Nova',
    description: 'Sans sac, filtre HEPA lavable, enrouleur de câble.',
    basePriceCents: 11_500_000,
    variants: single(13, 5200),
  },

  {
    category: 'mode',
    slug: 'chemise-pagne-homme',
    name: 'Chemise pagne homme',
    brand: 'Atelier Cotonou',
    description: 'Coton wax, coupe droite, manches courtes. Cousue à Cotonou.',
    basePriceCents: 2_500_000,
    variants: [...sized('Indigo', 18, 320), ...sized('Bleu', 12, 320)],
  },
  {
    category: 'mode',
    slug: 'robe-wax-longue',
    name: 'Robe wax longue',
    brand: 'Atelier Cotonou',
    description: 'Wax authentique, doublure coton, fermeture dos invisible.',
    basePriceCents: 3_800_000,
    variants: sized('Noir', 10, 480),
  },
  {
    category: 'mode',
    slug: 't-shirt-coton-bio',
    name: 'T-shirt coton bio',
    brand: null,
    description: 'Jersey 180 g, col renforcé, teinture sans métaux lourds.',
    basePriceCents: 900_000,
    variants: COLOURS.flatMap((colour) => sized(colour, 30, 190)),
  },
  {
    category: 'mode',
    slug: 'sandales-cuir-artisanales',
    name: 'Sandales cuir artisanales',
    brand: 'Atelier Cotonou',
    description: "Cuir tanné localement, semelle cousue, se patine à l'usage.",
    basePriceCents: 4_200_000,
    variants: [
      { name: 'Pointure 40', stock: 8, attributes: { pointure: '40' } },
      { name: 'Pointure 41', stock: 12, attributes: { pointure: '41' } },
      { name: 'Pointure 42', stock: 14, attributes: { pointure: '42' } },
      { name: 'Pointure 43', stock: 9, attributes: { pointure: '43' } },
    ],
  },
  {
    category: 'mode',
    slug: 'sac-a-dos-toile-enduite',
    name: 'Sac à dos toile enduite',
    brand: null,
    description: 'Compartiment ordinateur 15 pouces, fond déperlant, bretelles matelassées.',
    basePriceCents: 3_100_000,
    variants: [
      { name: 'Kaki', stock: 22, attributes: { couleur: 'Kaki' } },
      { name: 'Noir', stock: 30, attributes: { couleur: 'Noir' } },
    ],
  },
  {
    category: 'mode',
    slug: 'montre-analogique-classique',
    name: 'Montre analogique classique',
    brand: 'Vibe',
    description: 'Mouvement quartz, verre minéral, bracelet cuir interchangeable.',
    basePriceCents: 5_500_000,
    variants: single(35, 85),
  },
  {
    category: 'mode',
    slug: 'casquette-brodee',
    name: 'Casquette brodée',
    brand: null,
    description: 'Six panneaux, visière préformée, sangle métal réglable.',
    basePriceCents: 700_000,
    variants: single(110, 120),
  },
  {
    category: 'mode',
    slug: 'foulard-en-coton-imprime',
    name: 'Foulard en coton imprimé',
    brand: 'Atelier Cotonou',
    description: 'Impression à la main, bords roulottés, 90 × 90 cm.',
    basePriceCents: 1_200_000,
    variants: single(64, 95),
  },

  {
    category: 'epicerie',
    slug: 'cafe-moulu-arabica-500-g',
    name: 'Café moulu arabica 500 g',
    brand: 'Terroir',
    description: 'Torréfaction moyenne, mouture filtre, sachet refermable.',
    basePriceCents: 850_000,
    variants: single(90, 520),
  },
  {
    category: 'epicerie',
    slug: 'miel-naturel-1-kg',
    name: 'Miel naturel 1 kg',
    brand: 'Terroir',
    description: 'Récolte du nord, non pasteurisé, cristallise naturellement.',
    basePriceCents: 1_400_000,
    variants: single(48, 1100),
  },
  {
    category: 'epicerie',
    slug: 'huile-de-palme-rouge-1-l',
    name: 'Huile de palme rouge 1 L',
    brand: 'Terroir',
    description: 'Pressage artisanal, filtrée, bouteille consignée.',
    basePriceCents: 450_000,
    variants: single(130, 1050),
  },
  {
    category: 'epicerie',
    slug: 'riz-parfume-5-kg',
    name: 'Riz parfumé 5 kg',
    brand: null,
    description: "Grain long, sac tissé refermable, récolte de l'année.",
    basePriceCents: 1_800_000,
    variants: single(75, 5100),
  },
  {
    category: 'epicerie',
    slug: 'piment-seche-moulu-200-g',
    name: 'Piment séché moulu 200 g',
    brand: 'Terroir',
    description: 'Séché au soleil, moulu gros, bocal en verre.',
    basePriceCents: 320_000,
    variants: single(140, 260),
  },
  {
    category: 'epicerie',
    slug: 'beurre-de-karite-brut-500-g',
    name: 'Beurre de karité brut 500 g',
    brand: 'Terroir',
    description: 'Non raffiné, sans parfum ajouté. Pot en verre ambré.',
    basePriceCents: 900_000,
    variants: single(85, 560),
  },
  {
    category: 'epicerie',
    slug: 'the-vert-menthe-100-sachets',
    name: 'Thé vert menthe 100 sachets',
    brand: 'Terroir',
    description: 'Mélange gunpowder et menthe séchée, boîte métal.',
    basePriceCents: 700_000,
    variants: single(96, 300),
  },
  {
    category: 'epicerie',
    slug: 'noix-de-cajou-grillees-400-g',
    name: 'Noix de cajou grillées 400 g',
    brand: 'Terroir',
    description: 'Grillées à sec, légèrement salées, calibre W240.',
    basePriceCents: 1_100_000,
    variants: single(68, 430),
  },
];

function skuOf(productSlug: string, index: number): string {
  const base = productSlug
    .split('-')
    .map((part) => part.slice(0, 3))
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  return `${base.slice(0, 12)}-${String(index + 1).padStart(2, '0')}`;
}

async function seedCatalog(catalog: CatalogRepository): Promise<number> {
  const categoryIds = new Map<string, string>();

  for (const [position, category] of CATEGORIES.entries()) {
    const created = await catalog.createCategory({
      id: randomUUID(),
      slug: category.slug,
      name: category.name,
      description: category.description,
      parentId: null,
      position,
    });

    categoryIds.set(category.slug, created.id);
  }

  let variants = 0;

  for (const product of PRODUCTS) {
    const categoryId = categoryIds.get(product.category);

    if (categoryId === undefined) {
      throw new Error(`"${product.slug}" points at the unknown category "${product.category}"`);
    }

    const created = await catalog.createProduct({
      id: randomUUID(),
      slug: product.slug,
      name: product.name,
      description: product.description,
      brand: product.brand,
      categoryId,
      // Published, because a seeded shop nobody can browse is not a seeded shop.
      status: 'active',
      basePriceCents: product.basePriceCents,
      currency: CURRENCY,
    });

    for (const [index, variant] of product.variants.entries()) {
      const row: NewVariant = {
        id: randomUUID(),
        productId: created.id,
        sku: skuOf(product.slug, index),
        name: variant.name,
        priceCents: variant.priceCents ?? product.basePriceCents,
        stock: variant.stock,
        attributes: variant.attributes,
        weightGrams: variant.weightGrams ?? null,
        isActive: true,
      };

      await catalog.createVariant(row);
      variants += 1;
    }
  }

  return variants;
}

async function main(): Promise<void> {
  const database = createDatabaseAdapter({ softDeleteModels: ['Product', 'Category', 'Address'] });
  const redis = new RedisConnection({
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
    logger,
  });

  await database.connect();
  await redis.connect();

  try {
    const container = createAppContainer();
    container.registerInstance(TOKENS.DatabaseAdapter, database);
    container.registerInstance(TOKENS.Redis, redis);

    registerSharedServices(container);
    registerModules([notificationModule, authModule, catalogModule], {
      container,
      provider: database.provider,
      adapter: database,
    });

    const catalog = container.resolve(CATALOG_REPOSITORY);
    const actors = container.resolve(AUTH_REPOSITORY);
    const passwords = container.resolve(PasswordService);

    // Refuses to run twice rather than producing a second shop next to the first: the slugs
    // are unique, so a re-run would fail halfway and leave the catalogue half-seeded.
    if ((await catalog.listCategories()).length > 0) {
      throw new Error('The catalogue is not empty — drop the database before seeding it again.');
    }

    const variants = await seedCatalog(catalog);
    const passwordHash = await passwords.hash(DEMO_PASSWORD);

    for (const account of [
      { actorType: 'agent', email: 'admin@boutique.bj', name: 'Administrateur', roles: ['admin'] },
      { actorType: 'customer', email: 'client@boutique.bj', name: 'Aïcha Doassi', roles: [] },
    ]) {
      if ((await actors.findByEmail(account.actorType, account.email)) !== null) {
        continue;
      }

      const created = await actors.createActor({
        id: randomUUID(),
        actorType: account.actorType,
        email: account.email,
        displayName: account.name,
        passwordHash,
        phone: null,
        roles: account.roles,
        permissions: [],
        status: 'active',
      });

      await actors.updateActor(created.actor.id, { emailVerifiedAt: new Date() });
    }

    process.stdout.write(
      `Seeded ${String(CATEGORIES.length)} categories, ${String(PRODUCTS.length)} products, ` +
        `${String(variants)} variants.\n` +
        `Sign in as admin@boutique.bj (agent) or client@boutique.bj (customer), ` +
        `password "${DEMO_PASSWORD}".\n`,
    );
  } finally {
    await database.disconnect();
    await redis.disconnect();
  }
}

await main();
