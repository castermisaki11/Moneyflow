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
