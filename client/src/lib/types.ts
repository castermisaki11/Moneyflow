import {
  Transaction,
  Budget,
  Goal,
  Recurring,
  Settings,
} from "../../../shared/types";

export type {
  Transaction,
  Budget,
  Goal,
  Recurring,
  Settings,
};

export type TxType = Transaction["type"];
export type Period = Budget["period"];
export type Freq = Recurring["freq"];

export interface MoneyFlowSummary {
  income: number;
  expense: number;
  saving: number;
  balance: number;
}

export interface MfNotification {
  id: string;
  kind: "budget_over" | "recurring_due";
  title: string;
  detail: string;
}
