/**
 * Drop-in replacement for the old tRPC client.
 *
 * Same call shapes (`trpc.<group>.<proc>.useQuery/useMutation`, `trpc.useUtils()`)
 * but every procedure reads/writes the on-device store in lib/localdb —
 * no server round-trip, no database. React-query caching, optimistic
 * updates (setData/getData/cancel/invalidate) and mutation handlers behave
 * exactly like before because they were always react-query underneath.
 */
import {
  useMutation as useRQMutation,
  useQuery as useRQQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { db } from "./localdb";
import type { PublicSettings, Budget, Goal, Recurring, Transaction, TxType } from "./types";

type LockoutStatus = {
  pinEnabled: boolean;
  lockedNow: boolean;
};

type Me = Awaited<ReturnType<typeof db.auth.me>>;

// ────────────────────────────────────────────────────────────────────────────
// Proc factories: generic bounds match tRPC's (data/error/variables), with
// mutation contexts typed loosely (`any`) because optimistic-update handlers
// in the views stash arbitrary rollback snapshots ({prev}).
// ────────────────────────────────────────────────────────────────────────────

interface QueryProc<TInput, TResult> {
  useQuery: (
    input?: TInput,
    opts?: Omit<UseQueryOptions<TResult, Error, TResult, readonly unknown[]>, "queryKey" | "queryFn">
  ) => UseQueryResult<TResult, Error>;
  queryKey: readonly [string];
}

interface MutationProc<TVars, TResult> {
  useMutation: (
    opts?: Omit<UseMutationOptions<TResult, Error, TVars, TCtx>, "mutationFn">
  ) => UseMutationResult<TResult, Error, TVars, TCtx>;
  queryKey: readonly [string];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TCtx = any;

export function makeQueryProc<TResult>(
  group: string,
  proc: string,
  fn: () => Promise<TResult>
): QueryProc<undefined, TResult>;
export function makeQueryProc<TInput, TResult>(
  group: string,
  proc: string,
  fn: (input: TInput) => Promise<TResult>
): QueryProc<TInput, TResult>;
export function makeQueryProc<TInput, TResult>(
  group: string,
  proc: string,
  fn: (input: TInput) => Promise<TResult>
): QueryProc<TInput, TResult> {
  const key = `${group}.${proc}`;
  const useQuery = (
    input?: TInput,
    opts?: Omit<UseQueryOptions<TResult, Error, TResult, readonly unknown[]>, "queryKey" | "queryFn">
  ) =>
    useRQQuery<TResult, Error>({
      queryKey: [key, input ?? null] as const,
      queryFn: () => fn((input ?? ({} as TInput)) as TInput),
      ...(opts as object | undefined),
    });
  return { useQuery, queryKey: [key] } as QueryProc<TInput, TResult>;
}

export function makeMutationProc<TVars, TResult>(
  group: string,
  proc: string,
  fn: (vars: TVars) => Promise<TResult>
): MutationProc<TVars, TResult> {
  const key = `${group}.${proc}`;
  const useMutation = (
    opts?: Omit<UseMutationOptions<TResult, Error, TVars, TCtx>, "mutationFn">
  ) =>
    useRQMutation<TResult, Error, TVars, TCtx>({
      mutationFn: (vars: TVars) => fn(vars),
      ...(opts as object | undefined),
    });
  return { useMutation, queryKey: [key] } as MutationProc<TVars, TResult>;
}

type UpdateValueOrUpdater<TData> =
  | TData
  | undefined
  | ((old: TData | undefined) => TData | undefined);

type UtilsParam<TData> = {
  cancel: () => Promise<void>;
  getData: () => TData | undefined;
  setData: (filter: undefined, value: UpdateValueOrUpdater<TData>) => unknown;
  invalidate: () => Promise<void>;
  /** tRPC's fetch(input, opts) — opts accepted but unnecessary: local data is always current */
  fetch: (input?: any, opts?: { staleTime?: number }) => Promise<TData>;
  refetch: () => Promise<void>;
};

function utilsParam<TData>(qc: QueryClient, key: string, fn: (input: any) => Promise<TData>) {
  return {
    cancel: () => qc.cancelQueries({ queryKey: [key] }),
    getData: () => qc.getQueryData<TData>([key]),
    setData: (_filter: undefined, value: UpdateValueOrUpdater<TData>) =>
      qc.setQueryData([key], value as TData | undefined),
    invalidate: () => qc.invalidateQueries({ queryKey: [key] }).then(() => undefined),
    fetch: (input?: any, _opts?: { staleTime?: number }) => fn(input) as Promise<TData>,
    refetch: () =>
      Promise.resolve(qc.refetchQueries({ queryKey: [key] })).then(() => undefined),
  } as UtilsParam<TData>;
}

export function useUtils() {
  const qc = useQueryClient();
  return {
    auth: {
      me: utilsParam<Me>(qc, "auth.me", db.auth.me),
      logout: utilsParam(qc, "auth.logout", db.auth.logout),
    },
    settings: {
      get: utilsParam<PublicSettings>(qc, "settings.get", db.settings.get),
      update: utilsParam(qc, "settings.update", db.settings.update),
    },
    security: {
      status: utilsParam<LockoutStatus>(qc, "security.status", db.security.status),
      setPin: utilsParam(qc, "security.setPin", db.security.setPin),
      disablePin: utilsParam(qc, "security.disablePin", db.security.disablePin),
      verifyPin: utilsParam(qc, "security.verifyPin", db.security.verifyPin),
    },
    transactions: {
      list: utilsParam<Transaction[]>(qc, "transactions.list", db.transactions.list),
      create: utilsParam(qc, "transactions.create", db.transactions.create),
      update: utilsParam(qc, "transactions.update", db.transactions.update),
      remove: utilsParam(qc, "transactions.remove", db.transactions.remove),
    },
    budgets: {
      list: utilsParam<Budget[]>(qc, "budgets.list", db.budgets.list),
      create: utilsParam(qc, "budgets.create", db.budgets.create),
      remove: utilsParam(qc, "budgets.remove", db.budgets.remove),
    },
    goals: {
      list: utilsParam<Goal[]>(qc, "goals.list", db.goals.list),
      create: utilsParam(qc, "goals.create", db.goals.create),
      addAmount: utilsParam(qc, "goals.addAmount", db.goals.addAmount),
      remove: utilsParam(qc, "goals.remove", db.goals.remove),
    },
    recurring: {
      list: utilsParam<Recurring[]>(qc, "recurring.list", db.recurring.list),
      create: utilsParam(qc, "recurring.create", db.recurring.create),
      runNow: utilsParam(qc, "recurring.runNow", db.recurring.runNow),
      remove: utilsParam(qc, "recurring.remove", db.recurring.remove),
    },
  };
}

/**
 * The API object. Every namespace/proc pair is a real object with
 * useQuery/useMutation hooks, so call sites keep the same syntax as the
 * old tRPC client.
 */
export const trpc = {
  Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUtils,
  auth: {
    me: makeQueryProc("auth", "me", () => db.auth.me()),
    logout: makeMutationProc("auth", "logout", () => db.auth.logout()),
  },
  settings: {
    get: makeQueryProc("settings", "get", () => db.settings.get()),
    update: makeMutationProc("settings", "update", (input: any) => db.settings.update(input)),
  },
  security: {
    status: makeQueryProc("security", "status", () => db.security.status()),
    setPin: makeMutationProc(
      "security",
      "setPin",
      (input: { pin: string; currentPin?: string }) => db.security.setPin(input)
    ),
    disablePin: makeMutationProc(
      "security",
      "disablePin",
      (input: { currentPin: string }) => db.security.disablePin(input)
    ),
    verifyPin: makeMutationProc(
      "security",
      "verifyPin",
      (input: { pin: string }) => db.security.verifyPin(input)
    ),
  },
  transactions: {
    list: makeQueryProc("transactions", "list", (input: any) => db.transactions.list(input)),
    create: makeMutationProc(
      "transactions",
      "create",
      (input: {
        type: TxType;
        amount: number;
        category?: string | null;
        note?: string | null;
        occurredAt?: number;
      }) => db.transactions.create(input)
    ),
    update: makeMutationProc(
      "transactions",
      "update",
      (input: {
        id: number;
        type?: TxType;
        amount?: number;
        category?: string | null;
        note?: string | null;
        occurredAt?: number;
      }) => db.transactions.update(input)
    ),
    remove: makeMutationProc("transactions", "remove", (input: { id: number }) =>
      db.transactions.remove(input)
    ),
  },
  budgets: {
    list: makeQueryProc("budgets", "list", () => db.budgets.list()),
    create: makeMutationProc(
      "budgets",
      "create",
      (input: { category: string; limitAmount: number; period?: Budget["period"] }) =>
        db.budgets.create(input)
    ),
    remove: makeMutationProc("budgets", "remove", (input: { id: number }) =>
      db.budgets.remove(input)
    ),
  },
  goals: {
    list: makeQueryProc("goals", "list", () => db.goals.list()),
    create: makeMutationProc(
      "goals",
      "create",
      (input: {
        name: string;
        emoji?: string | null;
        targetAmount: number;
        deadline?: number | null;
      }) => db.goals.create(input)
    ),
    addAmount: makeMutationProc("goals", "addAmount", (input: { id: number; amount: number }) =>
      db.goals.addAmount(input)
    ),
    remove: makeMutationProc("goals", "remove", (input: { id: number }) => db.goals.remove(input)),
  },
  recurring: {
    list: makeQueryProc("recurring", "list", () => db.recurring.list()),
    create: makeMutationProc(
      "recurring",
      "create",
      (input: {
        type: TxType;
        amount: number;
        category?: string | null;
        note?: string | null;
        freq: Recurring["freq"];
        nextDate: number;
      }) => db.recurring.create(input)
    ),
    runNow: makeMutationProc("recurring", "runNow", (input: { id: number }) =>
      db.recurring.runNow(input)
    ),
    remove: makeMutationProc("recurring", "remove", (input: { id: number }) =>
      db.recurring.remove(input)
    ),
  },
};

// Re-export row/entity types for modules that used to import them via trpc
export type { Transaction, Budget, Goal, Recurring, PublicSettings, TxType };
