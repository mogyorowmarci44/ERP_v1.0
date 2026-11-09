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
};

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
    /** Könyvelési árfolyam (HUF / 1 deviza). HUF számlán 1. */
    exchangeRate: rate("exchange_rate").notNull().default(1),
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
