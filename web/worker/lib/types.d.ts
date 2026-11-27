export interface Env {
  ASSETS: Fetcher;
  REAI_ORIGIN?: string;
  SESSION_SECRET?: string;
}

export interface ReAITenant {
  id: number;
  companyName: string;
  currencyCode: string;
}

export interface SessionData {
  accessToken: string;
  tenantId: number;
  tenants: ReAITenant[];
  issuedAt: number;
}

export interface PublicSession {
  connected: boolean;
  tenantId: number;
  tenants: ReAITenant[];
}

export interface CompanySettings {
  company: {
    name: string;
    organizationNumber: string | null;
  };
  vatRegistered: boolean;
}

export interface LedgerAccount {
  accountNumber: string;
  number: string;
  restrictedToSystemUsage: boolean;
  subsidiaryLedger: {
    type: string;
    id: number;
  } | null;
}

export interface CompanyBank {
  id: number;
  ledgerAccountNumber: string;
  currencyCode: string;
  archived: boolean;
}

export interface VoucherSummary {
  id: number;
  number: string;
  description: string | null;
}

export interface JournalEntryInput {
  date: string;
  account: string;
  minor: number;
  reference: string;
  description: string;
}

export interface HybelPayload {
  sourceOrganization: string;
  month: string;
  fingerprint: string;
  entries: JournalEntryInput[];
}
