import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  varchar,
  boolean,
  date,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/** Pénzösszeg: numeric(18,2), JS-ben number – mindig round2-vel számolunk. */
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" });
const rate = (name: string) => numeric(name, { precision: 18, scale: 6, mode: "number" });

// ---------------------------------------------------------------------------
// Enumok
// ---------------------------------------------------------------------------

/** Számlaosztály szerinti típus (1–3 eszköz, 4 forrás, 5–8 költség/ráfordítás, 9 bevétel). */
export const accountTypeEnum = pgEnum("account_type", [
  "asset", // eszköz (1–3)
  "liability", // kötelezettség (44–49)
  "equity", // saját tőke (41–43)
  "expense", // költség / ráfordítás (5–8)
  "revenue", // bevétel (9)
  "off_balance", // 0 – nyilvántartási számlák
]);

export const vatKindEnum = pgEnum("vat_kind", [
  "normal", // általános szabályok szerinti ÁFA (27/18/5%)
  "margin", // különbözeti adózás – használt cikk (Áfa tv. XVI. fejezet)
  "exempt", // tárgyi adómentes (AM)
  "out_of_scope", // ÁFA tv. hatályán kívüli (ÁKK/TAH)
  "reverse_charge", // fordított adózás (belföldi / szolgáltatás import)
  "eu_acquisition", // Közösségen belüli termékbeszerzés
  "eu_supply", // Közösségen belüli adómentes termékértékesítés
  "export", // Harmadik országba történő export
  "non_deductible", // ÁFA-t tartalmazó beszerzés, nem levonható (a költség / készlet része)
]);

export const invoiceDirectionEnum = pgEnum("invoice_direction", ["out", "in"]); // out = vevő, in = szállító
export const docStatusEnum = pgEnum("doc_status", ["draft", "posted", "cancelled"]);
export const vatPeriodEnum = pgEnum("vat_period", ["monthly", "quarterly", "yearly"]);
export const roleEnum = pgEnum("member_role", ["owner", "accountant", "viewer"]);
export const vehicleStatusEnum = pgEnum("vehicle_status", ["in_stock", "reserved", "sold"]);
export const vehicleVatEnum = pgEnum("vehicle_vat", ["margin", "normal"]);

// ---------------------------------------------------------------------------
// Felhasználók, cégek
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cégszintű könyvelési beállítások (alapértelmezett főkönyvi számlák kódjai). */
export type CompanySettings = {
  receivableDomestic: string; // 311
  receivableForeign: string; // 316
  payableDomestic: string; // 454
  payableForeign: string; // 455
  inputVat: string; // 466
  outputVat: string; // 467
  vatSettlement: string; // 468
  inventoryGoods: string; // 261 – gépkocsik (kereskedelmi áru)
  cogs: string; // 814 – eladott áruk beszerzési értéke
  fxGain: string; // 976
  fxLoss: string; // 876
  roundingAccount: string; // kerekítési különbözet
  /** Szerződésekhez: a cég képviselője (ügyvezető), beosztása, a szerződéskötés helye. */
  representative?: string | null;
  representativeTitle?: string | null;
  signPlace?: string | null;
};

export type CompanyTheme = { preset: string; accent: string; sidebar: string; mode: "light" | "dark" };

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  taxNumber: varchar("tax_number", { length: 20 }), // 12345678-2-42
  euVatNumber: varchar("eu_vat_number", { length: 20 }), // HU12345678
  registrationNumber: varchar("registration_number", { length: 30 }), // cégjegyzékszám
  address: text("address"),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull().default("HUF"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  vatPeriod: vatPeriodEnum("vat_period").notNull().default("monthly"),
  settings: jsonb("settings").$type<CompanySettings>().notNull(),
  /** Megjelenés: téma (preset + egyedi színek). */
  theme: jsonb("theme").$type<CompanyTheme>(),
  /** Céglogó base64-ben (a Render ingyenes példány fájlrendszere nem tartós). */
  logoData: text("logo_data"),
  logoMime: varchar("logo_mime", { length: 40 }),
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("owner"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId] })],
);

// ---------------------------------------------------------------------------
// Számlatükör, ÁFA-kódok, naplók
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 12 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    type: accountTypeEnum("type").notNull(),
    /** Könyvelhető-e (gyűjtő számlákra nem könyvelünk). */
    isPosting: boolean("is_posting").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    /** Mérleg / eredménykimutatás sor hozzárendelés (későbbi riportokhoz). */
    reportLine: varchar("report_line", { length: 20 }),
    /** Pénzeszköz számla devizaneme (pl. 3841 devizaszámla: EUR). Egyéb számláknál HUF. */
    currency: varchar("currency", { length: 3 }).notNull().default("HUF"),
  },
  (t) => [uniqueIndex("accounts_company_code").on(t.companyId, t.code)],
);

export const vatCodes = pgTable(
  "vat_codes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 16 }).notNull(), // pl. "27", "KÜL27", "AM"
    name: varchar("name", { length: 255 }).notNull(),
    rate: numeric("rate", { precision: 5, scale: 2, mode: "number" }).notNull(), // 27.00
    kind: vatKindEnum("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("vat_codes_company_code").on(t.companyId, t.code)],
);

export const journals = pgTable(
  "journals",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 8 }).notNull(), // VE, SZ, BA, PE, VN
    name: varchar("name", { length: 100 }).notNull(),
  },
  (t) => [uniqueIndex("journals_company_code").on(t.companyId, t.code)],
);

/** Lezárt időszakok – ide már nem lehet könyvelni. */
export const periodLocks = pgTable(
  "period_locks",
  {
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: integer("locked_by").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.year, t.month] })],
);

/** Hivatalos devizaárfolyamok (MNB), Ft / 1 egység. Cégfüggetlen gyorsítótár. */
export const fxRates = pgTable(
  "fx_rates",
  {
    currency: varchar("currency", { length: 3 }).notNull(),
    date: date("date").notNull(),
    rate: rate("rate").notNull(),
    source: varchar("source", { length: 10 }).notNull().default("MNB"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
);

// ---------------------------------------------------------------------------
// Partnerek, gépkocsik
// ---------------------------------------------------------------------------

export const partners = pgTable(
  "partners",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    taxNumber: varchar("tax_number", { length: 20 }),
    euVatNumber: varchar("eu_vat_number", { length: 20 }),
    country: varchar("country", { length: 2 }).notNull().default("HU"),
    address: text("address"),
    isPrivatePerson: boolean("is_private_person").notNull().default(false),
    email: varchar("email", { length: 255 }),
    note: text("note"),
  },
  (t) => [index("partners_company").on(t.companyId)],
);

/**
 * Gépkocsi (egyedi készletnyilvántartás). A bekerülési érték a főkönyvi tételekből
 * (vehicle_id + készletszámla) számolódik; a `purchasePrice` a különbözeti ÁFA alapja
 * (csak a beszerzési ár, a javítási költség nem – Áfa tv. 214. §).
 */
export const vehicles = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    vin: varchar("vin", { length: 32 }),
    plate: varchar("plate", { length: 16 }),
    make: varchar("make", { length: 64 }).notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    year: integer("year"),
    vatTreatment: vehicleVatEnum("vat_treatment").notNull().default("margin"),
    purchaseDate: date("purchase_date"),
    purchasePrice: money("purchase_price"), // HUF – különbözeti ÁFA alapja
    status: vehicleStatusEnum("status").notNull().default("in_stock"),
    note: text("note"),
  },
  (t) => [index("vehicles_company").on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Főkönyv
// ---------------------------------------------------------------------------

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    journalId: integer("journal_id").notNull().references(() => journals.id),
    /** Naplón és éven belüli sorszám, pl. VE-2026/000123 */
    number: varchar("number", { length: 32 }).notNull(),
    date: date("date").notNull(), // könyvelés dátuma (teljesítés / bizonylat kelte)
    description: text("description").notNull(),
    sourceType: varchar("source_type", { length: 20 }), // invoice | payment | manual | storno
    sourceId: integer("source_id"),
    reversalOfId: integer("reversal_of_id"),
    reversedById: integer("reversed_by_id"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_entries_company_number").on(t.companyId, t.number),
    index("journal_entries_company_date").on(t.companyId, t.date),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accounts.id),
    debit: money("debit").notNull().default(0),
    credit: money("credit").notNull().default(0),
    description: text("description"),
    partnerId: integer("partner_id").references(() => partners.id),
    vehicleId: integer("vehicle_id").references(() => vehicles.id),
    vatCodeId: integer("vat_code_id").references(() => vatCodes.id),
    currency: varchar("currency", { length: 3 }),
    amountFx: money("amount_fx"),
    fxRate: rate("fx_rate"),
  },
  (t) => [
    index("journal_lines_entry").on(t.entryId),
    index("journal_lines_company_account").on(t.companyId, t.accountId),
    index("journal_lines_vehicle").on(t.vehicleId),
  ],
);

// ---------------------------------------------------------------------------
// Számlák
// ---------------------------------------------------------------------------

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    direction: invoiceDirectionEnum("direction").notNull(),
    partnerId: integer("partner_id").notNull().references(() => partners.id),
    invoiceNumber: varchar("invoice_number", { length: 64 }).notNull(),
    issueDate: date("issue_date").notNull(),
    fulfillmentDate: date("fulfillment_date").notNull(), // teljesítés – ÁFA időszak
    dueDate: date("due_date"),
    paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("transfer"), // transfer | cash | card
    currency: varchar("currency", { length: 3 }).notNull().default("HUF"),
    /**
     * Átszámítási árfolyam (HUF / 1 deviza). HUF számlán 1.
     * Egységesen az ÁFA alap átszámításához használt árfolyam (Áfa tv. 80. §), a követelés /
     * kötelezettség könyv szerinti értéke is ezen (Szt. 60. § (5a)).
     */
    exchangeRate: rate("exchange_rate").notNull().default(1),
    /** Melyik nap árfolyama (Áfa tv. 80. § szerinti időpont). */
    rateDate: date("rate_date"),
    /** MNB = automatikusan lekért hivatalos árfolyam, manual = kézzel megadott. */
    rateSource: varchar("rate_source", { length: 10 }).notNull().default("MNB"),
    /** Időszakos elszámolású ügylet (Áfa tv. 58. §) – árfolyam a számla kibocsátásakor. */
    periodic: boolean("periodic").notNull().default(false),
    netHuf: money("net_huf").notNull().default(0),
    vatHuf: money("vat_huf").notNull().default(0),
    grossHuf: money("gross_huf").notNull().default(0),
    grossFx: money("gross_fx").notNull().default(0),
    status: docStatusEnum("status").notNull().default("draft"),
    journalEntryId: integer("journal_entry_id").references(() => journalEntries.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoices_company_dir_partner_number").on(t.companyId, t.direction, t.partnerId, t.invoiceNumber),
    index("invoices_company_fulfillment").on(t.companyId, t.fulfillmentDate),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4, mode: "number" }).notNull().default(1),
    /** Egységár a számla devizájában. Különbözeti tételnél BRUTTÓ egységár. */
    unitPrice: money("unit_price").notNull(),
    vatCodeId: integer("vat_code_id").notNull().references(() => vatCodes.id),
    /** Ellenszámla: bevétel (9) vevőszámlán, költség/készlet/eszköz szállítói számlán. */
    accountId: integer("account_id").notNull().references(() => accounts.id),
    vehicleId: integer("vehicle_id").references(() => vehicles.id),
    // Számított értékek (HUF)
    netHuf: money("net_huf").notNull().default(0),
    vatHuf: money("vat_huf").notNull().default(0),
    grossHuf: money("gross_huf").notNull().default(0),
    /** Különbözeti adózásnál: a beszerzési ár (HUF), amiből az árrés számolódott. */
    marginPurchaseHuf: money("margin_purchase_huf"),
  },
  (t) => [index("invoice_lines_invoice").on(t.invoiceId)],
);

/** Pénzügyi rendezés (bank / pénztár) számlához. */
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
    date: date("date").notNull(),
    /** Pénzeszköz számla (381 pénztár, 384 bank stb.) */
    moneyAccountId: integer("money_account_id").notNull().references(() => accounts.id),
    amountFx: money("amount_fx").notNull(), // számla devizájában
    fxRate: rate("fx_rate").notNull().default(1), // tényleges (banki) árfolyam
    amountHuf: money("amount_huf").notNull(), // pénzeszköz oldali HUF (tényleges árfolyamon)
    partnerHuf: money("partner_huf").notNull(), // vevő/szállító oldali HUF (számla árfolyamán)
    journalEntryId: integer("journal_entry_id").references(() => journalEntries.id),
    note: text("note"),
  },
  (t) => [index("payments_invoice").on(t.invoiceId)],
);

/** Tagi kölcsön befizetések lejárata (a tételek maguk a főkönyvben, a 4791-es számlán vannak). */
export const memberLoanTerms = pgTable("member_loan_terms", {
  entryId: integer("entry_id").primaryKey().references(() => journalEntries.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  /** Jelenlegi (a hosszabbítások utáni) lejárat. */
  dueDate: date("due_date").notNull(),
  /** Az eredeti szerződés szerinti lejárat (hosszabbítás előtt). Üres = megegyezik a jelenlegivel. */
  originalDueDate: date("original_due_date"),
  /** Szerződésszám, pl. TK-2026-003. */
  contractNo: varchar("contract_no", { length: 30 }),
  /** Devizás kölcsön: a kölcsön devizája és összege (a 4791 forintban, könyv szerinti értéken). */
  currency: varchar("currency", { length: 3 }),
  amountFx: money("amount_fx"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tagi kölcsön hosszabbítások – mindegyikhez szerződésmódosító okirat készül. */
export const memberLoanExtensions = pgTable(
  "member_loan_extensions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entryId: integer("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** A módosítás kelte. */
    extendedOn: date("extended_on").notNull(),
    days: integer("days").notNull(),
    fromDue: date("from_due").notNull(),
    toDue: date("to_due").notNull(),
    docNo: varchar("doc_no", { length: 40 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("member_loan_ext_seq").on(t.entryId, t.seq)],
);

/** Tagi kölcsön visszafizetés (TKV): bizonylatszám és – ha megadták – melyik kölcsön(ök)et törleszti. Megadás nélkül FIFO. */
export const memberLoanRepayments = pgTable("member_loan_repayments", {
  entryId: integer("entry_id").primaryKey().references(() => journalEntries.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  docNo: varchar("doc_no", { length: 30 }).notNull(),
  /** Kifejezett párosítás: [{ loanEntryId, amount }] (forint; devizásnál devizában). */
  allocations: jsonb("allocations").$type<Array<{ loanEntryId: number; amount: number }>>(),
  note: text("note"),
});

/** Devizás tagi kölcsön mozgások (visszafizetés devizában, fordulónapi átértékelés) devizaadatai. */
export const memberLoanFx = pgTable("member_loan_fx", {
  entryId: integer("entry_id").primaryKey().references(() => journalEntries.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 12 }).notNull(), // repayment | reval
  currency: varchar("currency", { length: 3 }).notNull(),
  amountFx: money("amount_fx").notNull().default(0),
  rate: rate("rate"),
});

// ---------------------------------------------------------------------------
// Tervezés (forecast)
// ---------------------------------------------------------------------------

/** Forgatókönyv-paraméterek: az alap a felhasználó inputja, a rosszabb / jobb ebből számolódik. */
export type ForecastScenarioParams = {
  /** Eladási ár módosítás (pl. −0.05 = −5%). */
  priceAdj: number;
  /** Eladás csúszása napokban (+ később, − korábban). */
  dateShiftDays: number;
  /** Autóhoz kötött tervezett költségek módosítása. */
  vehicleCostAdj: number;
  /** Ismétlődő / egyszeri költségek módosítása. */
  fixedCostAdj: number;
};
export type ForecastSettings = {
  pessimistic: ForecastScenarioParams;
  optimistic: ForecastScenarioParams;
  /** Tervezési horizont hónapokban (a folyó hónappal együtt). */
  horizonMonths: number;
  /** Helyi iparűzési adó mértéke (pl. 0.02). */
  hipaRate: number;
  /** Társasági adó mértéke. */
  taoRate: number;
  /** Honnan jöttek a forgatókönyv-paraméterek. */
  calibratedFrom?: string | null;
};

export const forecastSettings = pgTable("forecast_settings", {
  companyId: integer("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<ForecastSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Gépkocsi eladási terv – meglévő készletre (vehicleId) vagy tervezett beszerzésre (vehicleId nélkül). */
export const forecastPlans = pgTable(
  "forecast_plans",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    label: varchar("label", { length: 128 }),
    /** Tervezett beszerzés (csak vehicleId nélkül): bruttó vételár = különbözeti ÁFA alapja. */
    purchaseDate: date("purchase_date"),
    purchasePrice: money("purchase_price"),
    purchasePayment: varchar("purchase_payment", { length: 8 }).notNull().default("cash"),
    /** Tervezett eladás (bruttó, különbözeti ÁFA-val). */
    salePrice: money("sale_price"),
    saleDate: date("sale_date"),
    salePayment: varchar("sale_payment", { length: 8 }).notNull().default("bank"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("forecast_plans_company").on(t.companyId), uniqueIndex("forecast_plans_vehicle").on(t.vehicleId)],
);

/** Autóhoz kötött tervezett költség (javítás, fényezés, honosítás, fuvar …). */
export const forecastPlanCosts = pgTable(
  "forecast_plan_costs",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id").notNull().references(() => forecastPlans.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 200 }).notNull(),
    date: date("date"),
    net: money("net").notNull(),
    vatRate: integer("vat_rate").notNull().default(27),
    deductible: boolean("deductible").notNull().default(true),
    /** true: a gépkocsi bekerülési értékét növeli (ELÁBÉ-ként jelenik meg eladáskor); false: azonnal költség. */
    capitalize: boolean("capitalize").notNull().default(true),
    payment: varchar("payment", { length: 8 }).notNull().default("cash"),
  },
  (t) => [index("forecast_plan_costs_plan").on(t.planId)],
);

/** Ismétlődő és egyszeri tervtételek (költség, eszköz, tagi kölcsön, tőke, osztalék …). */
export const forecastItems = pgTable(
  "forecast_items",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** expense | asset | loan_in | loan_out | capital_in | dividend | other_in | other_out */
    category: varchar("category", { length: 16 }).notNull().default("expense"),
    description: varchar("description", { length: 200 }).notNull(),
    accountCode: varchar("account_code", { length: 10 }),
    partnerName: varchar("partner_name", { length: 200 }),
    net: money("net").notNull(),
    vatRate: integer("vat_rate").notNull().default(0),
    deductible: boolean("deductible").notNull().default(true),
    /** once | monthly | quarterly | yearly */
    frequency: varchar("frequency", { length: 10 }).notNull().default("monthly"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    payment: varchar("payment", { length: 8 }).notNull().default("bank"),
    source: varchar("source", { length: 10 }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("forecast_items_company").on(t.companyId)],
);

/** Számla-ellenőrzés: ki, mikor pipálta ki, és milyen állapotban volt akkor a számla (ujjlenyomat). */
export const invoiceChecks = pgTable("invoice_checks", {
  invoiceId: integer("invoice_id").primaryKey().references(() => invoices.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkedBy: integer("checked_by").references(() => users.id),
  /** A számla állapotának ujjlenyomata a kipipáláskor – ha azóta módosult, a pipa érvényét veszti. */
  fingerprint: varchar("fingerprint", { length: 64 }),
  note: text("note"),
  /** Hivatkozás az eredeti bizonylatra (Gmail, Drive, számlázz.hu …). */
  docUrl: text("doc_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Beérkező bizonylatok (Gmail / Drive / feltöltés) – „Beolvasás és könyvelés”
// ---------------------------------------------------------------------------

/** Forrás-beállítások cégenként: a Google-fiókban futó Apps Script web app címe és titkos kulcsa (titkosítva). */
export type InboxSettings = {
  scriptUrl?: string | null;
  /** AES-GCM-mel titkosított kulcs (base64). */
  secretEnc?: string | null;
  gmailQuery?: string | null;
  invoiceFolderId?: string | null;
  statementFolderId?: string | null;
  /** Ennél régebbi leveleket / fájlokat nem kér le (YYYY-MM-DD). */
  since?: string | null;
  /** Automatikus könyvelés, ha minden ellenőrzés rendben (különben minden a jóváhagyási listába kerül). */
  autoPost?: boolean;
};

export const inboxSettings = pgTable("inbox_settings", {
  companyId: integer("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<InboxSettings>().notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Kiolvasott bizonylat-adat (a Claude API vagy kézi javítás eredménye). */
export type ExtractedDoc = {
  docType: "invoice" | "credit_note" | "receipt" | "sale_contract" | "bank_statement" | "proforma" | "other";
  direction?: "in" | "out" | null;
  seller?: { name?: string | null; taxNumber?: string | null; euVat?: string | null; address?: string | null; privatePerson?: boolean | null } | null;
  buyer?: { name?: string | null; taxNumber?: string | null; euVat?: string | null; address?: string | null; privatePerson?: boolean | null } | null;
  invoiceNumber?: string | null;
  issueDate?: string | null;
  fulfillmentDate?: string | null;
  dueDate?: string | null;
  paymentMethod?: "cash" | "transfer" | "card" | null;
  paid?: boolean | null;
  currency?: string | null;
  periodic?: boolean | null;
  lines?: Array<{ description: string; quantity?: number | null; unitNet?: number | null; net: number; vatRate?: number | null; vatType?: string | null; vat?: number | null; gross?: number | null }>;
  totals?: { net?: number | null; vat?: number | null; gross?: number | null } | null;
  vehicle?: { make?: string | null; model?: string | null; plate?: string | null; vin?: string | null; year?: number | null; km?: number | null } | null;
  /** Hivatkozott eredeti számla (sztornó / helyesbítő). */
  refInvoiceNumber?: string | null;
  statement?: {
    accountNumber?: string | null; currency?: string | null; number?: string | null; periodFrom?: string | null; periodTo?: string | null;
    opening?: number | null; closing?: number | null;
    transactions: Array<{ date: string; valueDate?: string | null; amount: number; counterparty?: string | null; counterpartyAccount?: string | null; description?: string | null; reference?: string | null; fxAmount?: number | null; fxCurrency?: string | null }>;
  } | null;
  confidence?: number | null;
  notes?: string | null;
  /** Honnan jött az adat: table = CSV/Excel export, text = PDF-szövegréteg, ocr = Google Drive OCR, ai = Claude, none = kézi. */
  method?: "table" | "text" | "ocr" | "ai" | "none" | null;
  /** A kinyert nyers szöveg (ellenőrzéshez, újraolvasáshoz). */
  rawText?: string | null;
};

/** Könyvelési javaslat (amit a rendszer a kiolvasott adatból és a korábbi könyvelésekből összerakott). */
export type InboxProposal = {
  kind: "invoice" | "statement" | "none";
  invoice?: {
    direction: "in" | "out";
    partner: { id?: number | null; name: string; taxNumber?: string | null; privatePerson: boolean; country?: string | null };
    invoiceNumber: string; issueDate: string; fulfillmentDate: string; dueDate?: string | null;
    paymentMethod: "cash" | "transfer" | "card"; currency: string; periodic: boolean;
    lines: Array<{ description: string; quantity: number; unitPrice: number; accountCode: string; vatCode: string; vehicleId?: number | null; newVehicle?: boolean }>;
    payNow?: { date: string; accountCode: string } | null;
    vehicle?: { id?: number | null; make: string; model: string; plate?: string | null; vin?: string | null } | null;
  } | null;
  statement?: {
    moneyAccountCode: string;
    rows: Array<{ idx: number; date: string; amount: number; text: string; action: "pay_invoice" | "entry" | "transfer" | "skip" | "review"; invoiceId?: number | null; invoiceLabel?: string | null; accountCode?: string | null; done?: boolean; reason?: string | null }>;
  } | null;
  /** Ami miatt nem könyvelhető automatikusan. */
  issues: string[];
  /** Honnan jött a szabály (pl. „a partner 3 korábbi számlája alapján”). */
  basis?: string | null;
};

export const inboxDocuments = pgTable(
  "inbox_documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** gmail | drive | upload */
    source: varchar("source", { length: 10 }).notNull(),
    /** Forrásbeli azonosító (pl. Gmail üzenet + csatolmány, Drive fájl) – duplikáció ellen. */
    sourceRef: varchar("source_ref", { length: 200 }).notNull(),
    /** Hivatkozás az eredetire (Gmail / Drive link). */
    sourceUrl: text("source_url"),
    kind: varchar("kind", { length: 12 }).notNull().default("invoice"), // invoice | statement
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    /** A fájl base64-ben (a Neon ingyenes keretén belül; a bizonylatok jellemzően 50–500 kB). */
    data: text("data").notNull(),
    emailFrom: varchar("email_from", { length: 255 }),
    emailSubject: text("email_subject"),
    emailDate: timestamp("email_date", { withTimezone: true }),
    /** new | extracted | review | booked | duplicate | ignored | error */
    status: varchar("status", { length: 12 }).notNull().default("new"),
    extracted: jsonb("extracted").$type<ExtractedDoc>(),
    proposal: jsonb("proposal").$type<InboxProposal>(),
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbox_documents_ref").on(t.companyId, t.sourceRef), index("inbox_documents_status").on(t.companyId, t.status), index("inbox_documents_sha").on(t.companyId, t.sha256)],
);
