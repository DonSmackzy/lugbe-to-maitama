// =============================================================================
// LedgerProcessor — ALL money mutations go through here.
// Uses integer kobo exclusively. Returns immutable entry records.
// =============================================================================

import type { LedgerEntryKind, LedgerEntryRecord } from "@ltm/protocol";

export type LedgerEntry = {
  idemKey: string;
  accountId: string;
  kind: LedgerEntryKind;
  amountKobo: number;
  direction: "CREDIT" | "DEBIT";
  relatedEntityId: string | null;
};

export type LedgerResult =
  | { ok: true; entry: LedgerEntryRecord; newBalanceKobo: number }
  | { ok: false; reason: string };

/**
 * Pure ledger processor. The actual DB write is handled by the Colyseus server
 * after receiving this validated entry. This class only validates business rules
 * and produces the ledger record — it never performs I/O.
 */
export class LedgerProcessor {
  /**
   * Validate and build a debit entry.
   * @param currentBalanceKobo - Player's current authoritative balance
   * @param amountKobo - Must be a positive integer
   */
  static debit(
    currentBalanceKobo: number,
    entry: Omit<LedgerEntry, "direction">
  ): LedgerResult {
    if (!Number.isInteger(entry.amountKobo) || entry.amountKobo <= 0) {
      return { ok: false, reason: `amountKobo must be a positive integer, got ${entry.amountKobo}` };
    }
    if (currentBalanceKobo < entry.amountKobo) {
      return { ok: false, reason: "INSUFFICIENT_FUNDS" };
    }

    const record: LedgerEntryRecord = {
      id: crypto.randomUUID(),
      accountId: entry.accountId,
      kind: entry.kind,
      amountKobo: entry.amountKobo,
      direction: "DEBIT",
      idemKey: entry.idemKey,
      relatedEntityId: entry.relatedEntityId,
      createdAt: new Date(),
    };

    return {
      ok: true,
      entry: record,
      newBalanceKobo: currentBalanceKobo - entry.amountKobo,
    };
  }

  /**
   * Validate and build a credit entry.
   */
  static credit(
    currentBalanceKobo: number,
    entry: Omit<LedgerEntry, "direction">
  ): LedgerResult {
    if (!Number.isInteger(entry.amountKobo) || entry.amountKobo <= 0) {
      return { ok: false, reason: `amountKobo must be a positive integer, got ${entry.amountKobo}` };
    }

    const record: LedgerEntryRecord = {
      id: crypto.randomUUID(),
      accountId: entry.accountId,
      kind: entry.kind,
      amountKobo: entry.amountKobo,
      direction: "CREDIT",
      idemKey: entry.idemKey,
      relatedEntityId: entry.relatedEntityId,
      createdAt: new Date(),
    };

    return {
      ok: true,
      entry: record,
      newBalanceKobo: currentBalanceKobo + entry.amountKobo,
    };
  }
}
