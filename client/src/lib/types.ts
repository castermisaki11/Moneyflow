export type TxType = "income" | "expense" | "saving";
export type Period = "daily" | "weekly" | "monthly" | "yearly";
export type Freq = "daily" | "weekly" | "monthly" | "yearly";
export type ThemeMode = "dark" | "light" | "auto";

export interface Transaction {
  id: number;
  type: TxType;
  /** decimal(14,2) stored as string, matching the old server JSON */
  amount: string;
  category: string | null;
  note: string | null;
  /** Unix ms */
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Budget {
  id: number;
  category: string;
  limitAmount: string;
  period: Period;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: number;
  name: string;
  emoji: string | null;
  targetAmount: string;
  savedAmount: string;
  deadline: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Recurring {
  id: number;
  type: TxType;
  amount: string;
  category: string | null;
  note: string | null;
  freq: Freq;
  nextDate: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  currency: string;
  theme: ThemeMode;
  myAccountNumber: string | null;
  customCategories: string | null;
  deletedDefaultCategories: string | null;
  /** Never expose this through queries — security.status only reports pinEnabled */
  pinHash: string | null;
}

/** What the API layer exposes for settings (pinHash stripped) */
export type PublicSettings = Omit<Settings, "pinHash">;
