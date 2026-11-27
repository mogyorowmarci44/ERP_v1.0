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
  bigserial,
  customType,
} from "drizzle-orm/pg-core";
import { decryptField, encryptField } from "../lib/field-crypto";

/** Pénzösszeg: numeric(18,2), JS-ben number – mindig round2-vel számolunk. */
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" });

/** v6.1.0 – Titkosítva tárolt szöveg (AES-256-GCM, ld. lib/field-crypto). Olvasáskor automatikusan visszafejtődik. */
const encText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => encryptField(v) as string,
  fromDriver: (v) => decryptField(v) as string,
});
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
/** v2.0 – Az entitás jogi formája: társaság (Bt/Kft/Zrt) vagy adószámos magánszemély. */
export const entityTypeEnum = pgEnum("entity_type", ["company", "private_taxpayer"]);
/** v5.0.0 – Tevékenységprofil: autókereskedés vagy általános (a tevékenységi kör még nem ismert). */
export const activityProfileEnum = pgEnum("activity_profile", ["car_dealer", "general", "services", "trade"]);

// ---------------------------------------------------------------------------
// Felhasználók, cégek
// ---------------------------------------------------------------------------

/** v6.0.0 – Ügyfélfiók (előfizető): a cégek és felhasználók ehhez tartoznak; egymás adatait nem látják. */
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Kötelező-e a kétlépcsős azonosítás ennek az ügyfélfióknak a felhasználóira. */
  mfaRequired: boolean("mfa_required").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** v6.0.0 – az ügyfélfiók, amelyhez a felhasználó tartozik. */
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  /** v6.0.0 – üzemeltető (a rendszer gazdája): ügyfélfiókokat hoz létre, támogatói hozzáférést kérhet. Az isAdmin az ügyfélfiók adminja. */
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // v2.2 – kétlépcsős azonosítás (TOTP) és munkamenet-kezelés
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** A legutóbb elfogadott TOTP lépés (visszajátszás ellen). */
  totpLastStep: integer("totp_last_step"),
  /** Egyszer használható tartalékkódok SHA-256 hash-ei. */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
  mfaFailedCount: integer("mfa_failed_count").notNull().default(0),
  mfaLockedUntil: timestamp("mfa_locked_until", { withTimezone: true }),
  /** Növelése az összes korábbi munkamenetet érvényteleníti (jelszócsere, 2FA visszaállítás). */
  sessionVersion: integer("session_version").notNull().default(0),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** v6.1.0 – az ÁSZF és az adatkezelési tájékoztató elfogadása (melyik változat, mikor). */
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: varchar("terms_version", { length: 20 }),
});

// ---------------------------------------------------------------------------
// v2.2 – Tárgyi eszközök és értékcsökkenés (ÉCS)
// ---------------------------------------------------------------------------

/** Tárgyi eszköz / immateriális javak analitika (eszközkarton). */
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    inventoryNo: varchar("inventory_no", { length: 32 }),
    serialNo: varchar("serial_no", { length: 64 }),
    /** Eszközszámla (pl. 141, 142, 143, 114), az ÉCS-számla (pl. 149) ebből adódik. */
    accountCode: varchar("account_code", { length: 12 }).notNull(),
    activationDate: date("activation_date").notNull(),
    cost: money("cost").notNull(),
    salvage: money("salvage").notNull().default(0),
    /** Hasznos élettartam hónapban (lineáris, napi arányosítással). */
    usefulLifeMonths: integer("useful_life_months").notNull().default(36),
    /** Adótörvény szerinti éves kulcs %-ban; null = a számvitelivel egyező. */
    taxRatePct: numeric("tax_rate_pct", { precision: 6, scale: 2 }),
    /** linear = terv szerinti havi ÉCS; lowvalue = kisértékű, egy összegben leírva aktiváláskor. */
    method: varchar("method", { length: 12 }).notNull().default("linear"),
    status: varchar("status", { length: 12 }).notNull().default("active"), // active | disposed
    disposedOn: date("disposed_on"),
    location: varchar("location", { length: 128 }),
    note: text("note"),
    /** Nyitó adat: a nyilvántartásba vétel előtt már elszámolt ÉCS (számviteli / adótörvényi). */
    openingAccumulated: money("opening_accumulated").notNull().default(0),
    openingTaxAccumulated: money("opening_tax_accumulated").notNull().default(0),
    /** A beszerzés könyvelt számlasora (ha számlából vettük nyilvántartásba). */
    invoiceLineId: integer("invoice_line_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fixed_assets_company").on(t.companyId), uniqueIndex("fixed_assets_invoice_line").on(t.invoiceLineId)],
);

/** Elszámolt ÉCS havonta eszközönként (a könyvelési tétellel). Egy eszköz egy hónapjára csak egy sor. */
export const assetDepreciation = pgTable(
  "asset_depreciation",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    assetId: integer("asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
    period: varchar("period", { length: 7 }).notNull(), // YYYY-MM
    amount: money("amount").notNull(),
    taxAmount: money("tax_amount").notNull(),
    kind: varchar("kind", { length: 12 }).notNull().default("linear"), // linear | lowvalue
    journalEntryId: integer("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_depreciation_period").on(t.assetId, t.period)],
);

/** v2.2 – ÁFA-zárás: a bevallási időszak 466 / 467 egyenlegének átvezetése a 468-ra. */
export const vatClosings = pgTable("vat_closings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  payable: money("payable").notNull(), // + fizetendő, − visszaigényelhető / levonható többlet
  journalEntryId: integer("journal_entry_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("vat_closings_period").on(t.companyId, t.toDate)]);

/** v2.2 – Bérszámfejtés: évenkénti paraméterek (felülírják a beépített alapértékeket; országos, nem cégenkénti). */
export const payrollParams = pgTable("payroll_params", {
  year: integer("year").primaryKey(),
  values: jsonb("values").$type<Record<string, number | string>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  /** v6.1.0 – titkosítva tárolva. */
  taxId: encText("tax_id"),
  position: varchar("position", { length: 128 }),
  partnerId: integer("partner_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("employees_company").on(t.companyId)]);

/** Jogviszony: full | part6 | part4 | part | efo_casual | efo_seasonal | member. */
export const employments = pgTable("employments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 16 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  monthlyWage: money("monthly_wage").notNull().default(0),
  dailyWage: money("daily_wage").notNull().default(0),
  weeklyHours: integer("weekly_hours"),
  guaranteedMin: boolean("guaranteed_min").notNull().default(false),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("employments_company").on(t.companyId)]);

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  period: varchar("period", { length: 7 }).notNull(),
  status: varchar("status", { length: 12 }).notNull().default("draft"), // draft | posted
  journalEntryId: integer("journal_entry_id"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payroll_runs_period").on(t.companyId, t.period)]);

export const payrollItems = pgTable("payroll_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employmentId: integer("employment_id").notNull().references(() => employments.id, { onDelete: "cascade" }),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
}, (t) => [uniqueIndex("payroll_items_run_emp").on(t.runId, t.employmentId)]);

/** v2.2 – Kiegészítő import csomagok (mm-erp-delta/1): egy betöltés = egy köteg. */
export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }),
  note: text("note"),
  items: integer("items").notNull().default(0),
  summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
  userId: integer("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A csomag tételeinek azonosítója (ref) cégenként egyedi – így ugyanaz a tétel kétszer nem könyvelődik. */
export const importRefs = pgTable(
  "import_refs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    ref: varchar("ref", { length: 128 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    journalEntryId: integer("journal_entry_id"),
    invoiceId: integer("invoice_id"),
    assetId: integer("asset_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_refs_company_ref").on(t.companyId, t.ref), index("import_refs_entry").on(t.journalEntryId)],
);

/** v2.2 – Rendszerszintű beállítások (kulcs → JSON), pl. a kétlépcsős azonosítás kötelezősége. */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  /** EPR – díjátalány-fizetés választása (egész naptári évre szól). */
  eprFlatRate?: boolean | null;
  /** EPR – a KF kód 8. karaktere (származáskód) külföldről behozott gépjárműre. */
  eprOriginDigit?: string | null;
  /** v2.2 – Cégérték: eredményszorzó (alap 3) és diszkontráta (alap 0,15 = 15%/év). */
  valuationMultiple?: number | null;
  valuationDiscountRate?: number | null;
  /** v2.2 – A tényleges működés (operáció) kezdete, ISO dátum. A KPI-k és a cégérték időszaka ennél korábban nem kezdődik
   *  (pl. a cég alakulása és az első vásárlás után, de az értékesítés megkezdése előtti hetek nem hígítják az átlagokat). */
  operationStart?: string | null;
  /** v3.3.3 – HIPA: székhely és telephelyek (irányítószám, település, adóalap-megosztási arány 0–1). */
  hipaSites?: { zip: string; city: string; role: "seat" | "site"; share: number }[] | null;
  /** v3.3.3 – Adóévenkénti kézi tételek (üzleti év kezdőéve → összegek). */
  taxAdjustments?: Record<string, { taoIncrease?: number; taoDecrease?: number; hipaSubcontract?: number; hipaRnd?: number }> | null;
  /** v3.4.0 – AutóMérleg tartási költség: a lekötött pénz költsége (%/év) és a fix napi költség (Ft/nap). */
  holdingRatePct?: number | null;
  holdingFixPerDay?: number | null;
  /** v3.5.0 – KészletMérleg: ennyi napon belül elért nullszaldó már „beavatkozni” (piros). */
  merlegRedDays?: number | null;
  /** v3.9.4 – a napi összefoglalóból kihagyott (szándékosan készleten tartott) gépkocsik. */
  summaryExcludeVehicles?: number[] | null;
  /** v3.3.3 – Az ERP előtti évek elhatárolt vesztesége (keletkezés éve, összeg). */
  openingLosses?: { year: string; amount: number }[] | null;
  /** v6.2.0 – modulkapcsolók: csak a profil alapértelmezésétől eltérő értékek (ld. lib/modules.ts). */
  modules?: Partial<Record<import("../lib/modules").ModuleKey, boolean>> | null;
};

/** v2.0 – Adószámos magánszemély (pl. szálláshely-szolgáltatás) adózási profilja. */
export type TaxProfile = {
  /** Tevékenység: jelenleg szálláshely-szolgáltatás (egyéb szálláshely / magánszálláshely). */
  activity: "accommodation";
  /** Alanyi ÁFA-mentes (Áfa tv. XIII. fejezet) – a beszerzések ÁFÁ-ja nem vonható le. */
  vatExempt: boolean;
  /** SZJA: tételes átalányadó (szobánként) | 10% költséghányad | tételes költségelszámolás. */
  szjaMethod: "flat_rate_room" | "cost_ratio_10" | "itemized";
  rooms: number;
  beds?: number | null;
  /** Szálláshely település (IFA, tételes adó mértéke). */
  settlement?: string | null;
  /** Szálláshely nyilvántartási / NTAK azonosító (pl. MA…). */
  ntakId?: string | null;
  /** Tételes átalányadó évi összege szobánként (Ft) – 2 millió vendégéjszaka alatti településen 38 400 Ft. */
  flatRatePerRoom: number;
  /** Idegenforgalmi adó Ft / fő / vendégéjszaka (önkormányzati rendelet szerint). */
  ifaPerNight?: number | null;
  /** Értékesítési csatornák (Airbnb, közvetlen, weboldal…). */
  channels?: string[];
  /** IFA: átlagos fizető vendégszám egy éjszakára (18 év alattiak nélkül). */
  ifaAvgGuests?: number | null;
  /** IFA: vendégéjszakák évente és csatornánként (felülírja a számlákból becsült értéket). */
  ifaNights?: Record<string, { platform?: number | null; direct?: number | null }>;
  /** P&L: a TFH / IFA melyik csatornára számítva kerüljön az eredménybe. */
  pnlTaxInclude?: "both" | "platform" | "direct" | "none";
  /** (elavult) Megtérülés: állandó éves diszkontráta – helyette KSH-infláció. */
  discountRate?: number | null;
  /** Megtérülés: hosszú távú inflációs feltevés az MNB-előrejelzés utáni évekre (pl. 0.025). */
  inflationLongRun?: number | null;
  /** Ingatlan adatai a piaci érték becsléséhez (cím, hrsz, telek, alapterület, galéria, terasz, fajlagos ár, tőkésítési ráta). */
  property?: import("@/lib/valuation").PropertyInfo;
  /** Adatfrissítés forrásai: Airbnb iCal-export címe, Meta (Graph API) token, hirdetési fiók, Instagram-fiók azonosító. */
  sync?: { airbnbIcalUrl?: string | null; metaToken?: string | null; metaAdAccount?: string | null; igUserId?: string | null };
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
  /** v2.0 – jogi forma: company (Bt/Kft/Zrt) | private_taxpayer (adószámos magánszemély). */
  entityType: entityTypeEnum("entity_type").notNull().default("company"),
  /** v5.0.0 – tevékenységprofil (egyelőre csak címke; a profil szerinti modulkapcsolás a következő lépés). */
  activityProfile: activityProfileEnum("activity_profile").notNull().default("general"),
  /** v2.0 – magánszemély adózási profilja (társaságnál null). */
  taxProfile: jsonb("tax_profile").$type<TaxProfile>(),
  /** Megjelenés: téma (preset + egyedi színek). */
  theme: jsonb("theme").$type<CompanyTheme>(),
  /** Céglogó base64-ben (a Render ingyenes példány fájlrendszere nem tartós). */
  logoData: text("logo_data"),
  logoMime: varchar("logo_mime", { length: 40 }),
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** v6.0.0 – ügyfélfiók. */
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  /** v6.0.0 – archivált cég: csak olvasható, a listákból kikerül; végleges törlés csak türelmi idő után. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: integer("archived_by"),
  /** v6.0.0 – a legutóbbi teljes (első tételtől máig) adatexport ideje – archiválás előfeltétele. */
  lastFullExportAt: timestamp("last_full_export_at", { withTimezone: true }),
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
    /** EPR (80/2023. Korm. r.) – járműkategória: M1 | N1 | 3W (háromkerekű). */
    eprCategory: varchar("epr_category", { length: 4 }),
    /** EPR – hajtás: ice | hev | phev | bev (a díjátalány tétele ettől függ). */
    eprDrive: varchar("epr_drive", { length: 8 }),
    /** EPR – a díj alapjául szolgáló tömeg (kg), a forgalmi engedélyből. */
    eprMassKg: integer("epr_mass_kg"),
    /** EPR – származás kézi felülírása: import | domestic (null = a beszerzési számla partnerének országából). */
    eprOrigin: varchar("epr_origin", { length: 12 }),
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
    /** „Ellenőrzött” jelölés – a megjelölt tétel nem szerkeszthető, amíg a jelölést vissza nem veszik. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkedBy: integer("checked_by").references(() => users.id),
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

/** Lekönyvelt tételsor kiegészítő adatainak (szöveg, partner, gépkocsi) utólagos módosításai – audit napló. Összeg, számla, dátum nem módosítható. */
export const journalLineChanges = pgTable(
  "journal_line_changes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entryId: integer("entry_id").references(() => journalEntries.id, { onDelete: "cascade" }), // null: számlaszintű esemény (újranyitás, rendezés javítása)
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
    lineId: integer("line_id").references(() => journalLines.id, { onDelete: "set null" }), // null = a tétel feje / törölt sor
    field: varchar("field", { length: 20 }).notNull(), // description | partner | vehicle | entry_description | date | account | debit | credit | amount_fx | line_added | line_deleted | invoice_reopen | invoice_repost | payment_edit
    oldValue: text("old_value"),
    newValue: text("new_value"),
    userId: integer("user_id").references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("journal_line_changes_entry").on(t.entryId), index("journal_line_changes_invoice").on(t.invoiceId)],
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
    /** Újranyitott (javításra visszavett) számla eredeti könyvelési tételszáma – újrakönyveléskor ezt kapja vissza. */
    reuseEntryNumber: varchar("reuse_entry_number", { length: 32 }),
    /** v3.9.4 – rontott / érvénytelenített (papír) számla: piszkozatként, a sorszám miatt marad; nem könyvelhető, nem teendő. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    journalEntryId: integer("journal_entry_id").references(() => journalEntries.id),
    note: text("note"),
    /** v2.2 – helyesbítő számla: az eredeti (helyesbített) számla. */
    correctsInvoiceId: integer("corrects_invoice_id"),
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
    /** v2.2 – payment: a rendezés saját tétele · link: meglévő (kézi) tételhez párosítva · offset: beszámítás (helyesbítővel). */
    kind: varchar("kind", { length: 12 }).notNull().default("payment"),
  },
  (t) => [index("payments_invoice").on(t.invoiceId), index("payments_entry").on(t.journalEntryId)],
);

/** Tagi kölcsön befizetések lejárata (a tételek maguk a főkönyvben, a 4791-es számlán vannak). */
/** v4.5.0 – Tagok és tisztségviselők: jogviszony, tulajdonrész, személyes adatok (a tagi kölcsön okiratokhoz). */
export const companyMembers = pgTable("company_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  /** A tagi kölcsönök partnere (479x). */
  partnerId: integer("partner_id").references(() => partners.id, { onDelete: "set null" }),
  isMember: boolean("is_member").notNull().default(true),
  isCeo: boolean("is_ceo").notNull().default(false),
  sharePct: numeric("share_pct", { precision: 7, scale: 4, mode: "number" }),
  capital: money("capital"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  /** önálló | együttes */
  representation: varchar("representation", { length: 12 }),
  /** v6.1.0 – a születési hely, anyja neve, lakcím és adóazonosító jel titkosítva tárolva. */
  birthPlace: encText("birth_place"),
  birthDate: date("birth_date"),
  motherName: encText("mother_name"),
  address: encText("address"),
  taxId: encText("tax_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("company_members_company").on(t.companyId)]);

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
  /** Önkormányzati HIPA-mentesség (Htv. 39/C. § (2)): ha a vállalkozási szintű adóalap ennél kisebb, nincs HIPA. 0 = nincs mentesség. */
  hipaExemptBelow?: number;
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
    /** Ha meg van adva: a pénz a költség hónapját követő hónap ezen napján mozdul (pl. bér 10., NAV 12.). Üres = a tétel napján. */
    payDay: integer("pay_day"),
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
  /** v3.10.0: közvetlen banki kapcsolat (Enable Banking / PSD2) – napi automatikus tranzakció-letöltés. */
  bank?: BankLink | null;
};

export type BankLink = {
  provider: "enablebanking";
  aspsp: { name: string; country: string };
  psuType: "business" | "personal";
  sessionId: string;
  /** A hozzájárulás lejárata (ISO) – utána újra jóvá kell hagyni a bank appjában. */
  validUntil: string | null;
  accounts: Array<{ uid: string; iban: string | null; name: string | null; currency: string; enabled: boolean }>;
  /** Ennél korábbi napokat nem tölt le (alapértelmezés: az összekapcsolás napja). */
  since: string;
  connectedAt: string;
  lastRunAt?: string | null;
  lastResult?: string | null;
  lastError?: string | null;
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
    /** v3.1.0: papír alapú bizonylat iktatószáma (P-ÉÉÉÉ-0001) – ezt kell ráírni a papírra, a lefűzés sorrendje. */
    filingNo: varchar("filing_no", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbox_documents_ref").on(t.companyId, t.sourceRef), index("inbox_documents_status").on(t.companyId, t.status), index("inbox_documents_sha").on(t.companyId, t.sha256), uniqueIndex("inbox_documents_filing").on(t.companyId, t.filingNo)],
);

// ---------------------------------------------------------------------------
// v2.0 – Vendégház: foglalások és értékelések (külső forrásból szinkronizálva)
// ---------------------------------------------------------------------------

/** Foglalás külső forrásból (Airbnb-foglalás, Airbnb-naptárban kiblokkolt közvetlen foglalás, iCal). */
export const ghReservations = pgTable(
  "gh_reservations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 16 }).notNull(), // airbnb | direct | booking | ical
    code: varchar("code", { length: 60 }).notNull(),
    guest: text("guest"),
    guests: integer("guests"),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    amount: money("amount"),
    status: varchar("status", { length: 20 }).notNull().default("confirmed"),
    bookedOn: date("booked_on"),
    note: text("note"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gh_reservations_code_uq").on(t.companyId, t.code)],
);

export type ReviewRatings = { checkin?: number; cleanliness?: number; accuracy?: number; communication?: number; location?: number; value?: number; /** Google: szobák, szolgáltatás */ rooms?: number; service?: number };

/** Vendégértékelés (Airbnb): összpontszám, részletes pontok, címkék kategóriánként, szöveg, privát megjegyzés, válasz. */
export const ghReviews = pgTable(
  "gh_reviews",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 16 }).notNull().default("airbnb"),
    externalId: varchar("external_id", { length: 60 }).notNull(),
    guest: text("guest"),
    guestLocation: text("guest_location"),
    stayFrom: date("stay_from"),
    stayTo: date("stay_to"),
    reviewedAt: date("reviewed_at").notNull(),
    /** A dátum csak közelítő (pl. Google: „3 éve”). */
    dateApprox: boolean("date_approx").notNull().default(false),
    overall: integer("overall"),
    ratings: jsonb("ratings").$type<ReviewRatings>(),
    tags: jsonb("tags").$type<Record<string, string[]>>(),
    text: text("text"),
    privateNote: text("private_note"),
    reply: text("reply"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gh_reviews_ext_uq").on(t.companyId, t.externalId)],
);

/** Adatfrissítések naplója (forrásonként az utolsó futás eredménye). */
export const ghSyncLog = pgTable("gh_sync_log", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 24 }).notNull(),
  ok: boolean("ok").notNull(),
  message: text("message").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

/** Meta Ads napi statisztika (Graph API-ból frissítve). */
export const ghAdStats = pgTable(
  "gh_ad_stats",
  {
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: money("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.date] })],
);

// ---------------------------------------------------------------------------
// v2.2 – Éves beszámoló (mérleg + eredménykimutatás a főkönyvből, kiegészítő melléklet szövege)
// ---------------------------------------------------------------------------

/** Kiegészítő melléklet egy fejezete. A törzs egyszerű jelölésű szöveg: bekezdés, „- ” felsorolás, „| a | b |” táblázat, **félkövér**. */
export type AnnualSection = { no: string; title: string; body: string };

/** Az éves beszámoló fejléc- és aláírásadatai, valamint az eredetileg közzétett (helyesbített) számok. */
export type AnnualReportMeta = {
  /** pl. "Egyszerűsített éves beszámoló" */
  kind: string;
  /** pl. "Helyesbített változat – a 2026. évben feltárt jelentős összegű hibák hatásával" */
  versionLabel?: string | null;
  periodFrom: string;
  periodTo: string;
  /** Statisztikai számjel (KSH), ha ismert. */
  statNumber?: string | null;
  preparedPlace?: string | null;
  preparedAt?: string | null;
  /** A cég képviselője (aláíró). */
  signer?: string | null;
  signerTitle?: string | null;
  /** A beszámoló összeállításáért felelős személy. */
  preparer?: string | null;
  preparerRegNo?: string | null;
  /** Eredetileg közzétett (letétbe helyezett) adatok soronként – a mérleg és EK sorkulcsaival (pl. "BI", "IV8"). */
  filed?: { label?: string | null; date?: string | null; bs?: Record<string, number>; pnl?: Record<string, number> } | null;
};

export const annualReports = pgTable(
  "annual_reports",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    meta: jsonb("meta").$type<AnnualReportMeta>().notNull(),
    sections: jsonb("sections").$type<AnnualSection[]>().notNull().default([]),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("annual_reports_company_year").on(t.companyId, t.year)],
);

// ---------------------------------------------------------------------------
// v3.6.0 – NAV-bevallások (ÁNYK): beolvasott és előállított nyomtatványok nyilvántartása
// ---------------------------------------------------------------------------

/**
 * Egy bevallás egy változata (eredeti / önellenőrzés / helyesbítés). Forrás: az ÁNYK mentett nyomtatványa (.frm.enyk)
 * vagy XML-je, illetve az ERP által előállított XML. A „submitted” jelöli, hogy ez a változat ment be a NAV-hoz –
 * időszakonként ez az önellenőrzés összevetési alapja.
 */
export const taxFilings = pgTable(
  "tax_filings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** nyomtatvány-család: 2565, 2665, 2608 … */
    form: varchar("form", { length: 12 }).notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    /** original | self_revision | correction */
    kind: varchar("kind", { length: 16 }).notNull().default("original"),
    /** import | generated */
    source: varchar("source", { length: 12 }).notNull().default("import"),
    fileName: varchar("file_name", { length: 255 }),
    savedAt: timestamp("saved_at", { withTimezone: false }),
    signedAt: date("signed_at"),
    krFileName: varchar("kr_file_name", { length: 255 }),
    templateVer: varchar("template_ver", { length: 16 }),
    /** az összes lap (főlap + pótlapok) mezői: [{ id, version, fields }] */
    sheets: jsonb("sheets").$type<Array<{ id: string; version: string | null; fields: Record<string, string> }>>().notNull(),
    /** rövid összefoglaló (lapok száma, ÁFA eredménysorok) */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    submitted: boolean("submitted").notNull().default(false),
    receiptNo: varchar("receipt_no", { length: 40 }),
    note: text("note"),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tax_filings_hash").on(t.companyId, t.sha256), index("tax_filings_period").on(t.companyId, t.form, t.periodFrom)],
);

/**
 * v3.9.2 – Napi összefoglaló e-mail címzettjei cégenként. A változat a tartalmat adja:
 * ceo = számok + teendők + autókészlet, cfo = számok + teendők + pénzügyi napló (CSV melléklettel), full = mind.
 * A holding e-mail címzettjei az app_settings „dailySummary” kulcsában vannak (nem cégenkéntiek).
 */
export const summaryRecipients = pgTable(
  "summary_recipients",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    variant: varchar("variant", { length: 8 }).notNull().default("ceo"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("summary_recipients_company_email").on(t.companyId, t.email)],
);

// ---------------------------------------------------------------------------
// v4.5.3 – Típuskatalógus (cégfüggetlen): márka › modell › motorváltozat
// ---------------------------------------------------------------------------

export const carMakes = pgTable("car_makes", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull().unique("car_makes_name"),
  /** hasznaltauto.hu márka-azonosító és hirdetésszám (a katalógus körének alapja). */
  haId: integer("ha_id"),
  haCount: integer("ha_count"),
  haCountedAt: date("ha_counted_at"),
});

export const carModels = pgTable("car_models", {
  id: serial("id").primaryKey(),
  makeId: integer("make_id").notNull().references(() => carMakes.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  haId: integer("ha_id"),
  haCount: integer("ha_count"),
}, (t) => [uniqueIndex("car_models_make_name").on(t.makeId, t.name)]);

export const carVariants = pgTable("car_variants", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").notNull().references(() => carModels.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 20 }).notNull().default("auto-data"),
  sourceId: integer("source_id").notNull(),
  generation: varchar("generation", { length: 160 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** Évjárat-intervallum (gyártás kezdete–vége); year_to null = gyártásban. Évjáratonkénti keresés: year_from ≤ év ≤ coalesce(year_to, idei év). */
  yearFrom: integer("year_from"),
  monthFrom: integer("month_from"),
  yearTo: integer("year_to"),
  monthTo: integer("month_to"),
  /** ice | mhev | hev | phev | bev | fcev */
  powertrain: varchar("powertrain", { length: 12 }),
  body: varchar("body", { length: 60 }),
  /** benzin | dízel | elektromos | hibrid | LPG | CNG | hidrogén | egyéb */
  fuel: varchar("fuel", { length: 20 }),
  fuelRaw: varchar("fuel_raw", { length: 80 }),
  displacementCc: integer("displacement_cc"),
  powerHp: integer("power_hp"),
  powerKw: integer("power_kw"),
  engineCode: varchar("engine_code", { length: 80 }),
  /** fwd | rwd | awd */
  drive: varchar("drive", { length: 8 }),
  gears: integer("gears"),
  /** manuális | automata | DSG | CVT | robot */
  gearbox: varchar("gearbox", { length: 12 }),
  gearboxRaw: varchar("gearbox_raw", { length: 120 }),
  /** Saját tömeg tartomány; az EPR-hez a felső érték (legnehezebb kivitel). */
  kerbMinKg: integer("kerb_min_kg"),
  kerbMaxKg: integer("kerb_max_kg"),
  /** Megengedett össztömeg. */
  grossKg: integer("gross_kg"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("car_variants_source").on(t.source, t.sourceId), index("car_variants_model_years").on(t.modelId, t.yearFrom, t.yearTo)]);

// ---------------------------------------------------------------------------
// v6.0.0 – Belépésvédelem, egyszer használható linkek, tevékenységnapló, támogatói hozzáférés
// ---------------------------------------------------------------------------

/** Hibás belépések számlálója kulcsonként (email:… / ip:…). */
export const authThrottle = pgTable("auth_throttle", {
  key: varchar("key", { length: 320 }).primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/** Jelszó-visszaállító és meghívó linkek – csak a token SHA-256 hash-e tárolódik. */
export const userTokens = pgTable(
  "user_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 16 }).$type<"reset" | "invite">().notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_tokens_user_idx").on(t.userId)],
);

/** Tevékenységnapló – idegen kulcs nélkül, hogy törlés után is megmaradjon. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    organizationId: integer("organization_id"),
    companyId: integer("company_id"),
    userId: integer("user_id"),
    userEmail: varchar("user_email", { length: 255 }),
    action: varchar("action", { length: 64 }).notNull(),
    ok: boolean("ok").notNull().default(true),
    target: varchar("target", { length: 255 }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: varchar("ip", { length: 64 }),
  },
  (t) => [index("audit_log_org_at_idx").on(t.organizationId, t.at), index("audit_log_company_at_idx").on(t.companyId, t.at)],
);

/** Üzemeltetői (támogatói) hozzáférés egy ügyfél cégéhez – időkorlátos, csak olvasás. */
export const supportGrants = pgTable(
  "support_grants",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_grants_user_company_idx").on(t.userId, t.companyId)],
);
