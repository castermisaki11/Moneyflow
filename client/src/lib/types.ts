import {
  Transaction,
  Budget,
  Goal,
  WishItem,
  Recurring,
  Settings,
} from "../../../shared/types";

export type {
  Transaction,
  Budget,
  Goal,
  WishItem,
  Recurring,
  Settings,
};

export type TxType = Transaction["type"];
export type Period = Budget["period"];
export type Freq = Recurring["freq"];
export type Priority = WishItem["priority"];

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
