"use client";

import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMaskedCurrency } from "@/components/shared/use-masked-currency";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { parseWithMapping, type ParsedTransaction, type ColumnMapping } from "@/lib/csv-parsers";
import { findDuplicates } from "@/app/(app)/transactions/actions";
import { findBestPayeeMatch } from "@/lib/payee-match";

// The dialog is agnostic to what a "snapshot" is — it collects whatever
// `onImport` returns and forwards it to `onComplete`, which is where the caller
// turns it into a single Undo. Generic so the shared dialog never depends on
// the transactions action's snapshot shape.
type CSVImportDialogProps<TSnapshot> = {
  accounts: { id: string; name: string }[];
  payees: { name: string; default_category_id: string | null }[];
  categories: { id: string; name: string }[];
  onImport: (
    accountId: string,
    transactions: ParsedTransaction[]
  ) => Promise<{ imported: number; categorized: number; snapshots: TSnapshot[] }>;
  // Called once after all account groups import, with every created row's
  // snapshot, so the caller can raise a single Undo for the whole import.
  onComplete?: (snapshots: TSnapshot[]) => void;
  defaultAccountId?: string;
  // "button" = labelled outline trigger (default); "none" = no trigger, the
  // caller opens it via `open`/`onOpenChange` (e.g. from a menu item).
  trigger?: "button" | "none";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ImportState = "idle" | "preview" | "mapping" | "accountMapping" | "summary";

export function CSVImportDialog<TSnapshot>({ accounts, payees, categories, onImport, onComplete, defaultAccountId, trigger = "button", open: openProp, onOpenChange }: CSVImportDialogProps<TSnapshot>) {
  const fmt = useMaskedCurrency();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [bank, setBank] = useState("");
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ImportState>("idle");

  // Mapping state
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0, payee: 1, amount: 2 });

  // Multi-account mapping: keyed by the CSV's account name, value = Zero account id
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});

  // Duplicate detection
  const [duplicates, setDuplicates] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Summary
  const [summary, setSummary] = useState<{ imported: number; categorized: number; skipped: number } | null>(null);

  // Stable alphabetical sort of accounts for all Select UIs (top picker + per-row mapping).
  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));

  // True when the parsed CSV provided per-row accounts.
  const isMultiAccount = transactions.some((t) => !!t.account);

  // Distinct account names from the parsed rows (preserves first-seen order).
  const distinctCsvAccounts = Array.from(
    new Set(transactions.map((t) => t.account).filter((s): s is string => !!s))
  );

  // Payee → category lookup
  const payeeCategoryMap = new Map(
    payees
      .filter((p) => p.default_category_id)
      .map((p) => [p.name.toLowerCase(), p.default_category_id!])
  );
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  // Category name → name lookup, case-insensitive, for CSV-provided categories.
  const categoryByName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c.name])
  );

  const getResolvedPayee = (t: ParsedTransaction): { name: string; category: string | null } => {
    const payeeName = t.payee;

    // If the CSV row provided a category, prefer that when it matches an existing Zero category.
    if (t.category) {
      const matched = categoryByName.get(t.category.trim().toLowerCase());
      if (matched) return { name: payeeName, category: matched };
    }

    // Try exact match first
    const exactCatId = payeeCategoryMap.get(payeeName.toLowerCase());
    if (exactCatId) return { name: payeeName, category: categoryMap.get(exactCatId) ?? null };

    // Fuzzy match: normalize to clean payee name
    const match = findBestPayeeMatch(payeeName, payees);
    if (!match) return { name: payeeName, category: null };
    const catId = payeeCategoryMap.get(match.toLowerCase());
    return { name: match, category: catId ? categoryMap.get(catId) ?? null : null };
  };

  const runDuplicateDetection = useCallback(
    (acctId: string, txns: ParsedTransaction[]) => {
      if (!acctId || txns.length === 0) return;
      startTransition(async () => {
        // A failed duplicate scan must not dead-end the import — fall back to
        // no DB-side flags and keep the within-file detection below running.
        let dbDupes: number[] = [];
        try {
          dbDupes = await findDuplicates(acctId, txns);
        } catch {
          setError("Couldn't check for duplicates — importing without duplicate flags.");
        }
        // Within-file duplicates: mark second+ occurrence of same date|payee|amount
        const seen = new Map<string, number>();
        const fileDupes: number[] = [];
        for (let i = 0; i < txns.length; i++) {
          const key = `${txns[i].date}|${txns[i].payee.toLowerCase()}|${txns[i].amount}`;
          if (seen.has(key)) {
            fileDupes.push(i);
          } else {
            seen.set(key, i);
          }
        }
        // Flag only — do NOT auto-deselect. `findDuplicates` matches on (date, amount)
        // alone and the within-file key ignores nothing but case, so a legitimate repeat
        // charge (two $3.80 sodas on one day) is indistinguishable from a real duplicate.
        // Unticking on that evidence silently drops real money, and the error is
        // one-directional: it can only ever lose charges, never invent them, so it drifts
        // every balance optimistically. Surfacing the flag is a hint; unticking is a
        // decision — leave that to the user, who can see the payee we ignored.
        setDuplicates(new Set([...dbDupes, ...fileDupes]));
      });
    },
    [startTransition]
  );

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSummary(null);
    const formData = new FormData();
    formData.append("file", file);

    let res: Response;
    let data: { error?: string; needsMapping?: boolean; headers?: string[]; rows?: string[][]; bank?: string; transactions?: ParsedTransaction[] };
    try {
      res = await fetch("/api/import", { method: "POST", body: formData });
      // A non-JSON error body (a 500 HTML page, a proxy 502, a truncated
      // response, or a dropped connection) makes res.json() throw — without
      // this guard that's an unhandled rejection and the dialog shows nothing.
      data = await res.json();
    } catch {
      setError("Could not read that file — try again.");
      return;
    }

    if (!res.ok) {
      setError(data.error ?? "Import failed — try again.");
      return;
    }

    if (data.needsMapping) {
      setRawHeaders(data.headers ?? []);
      setRawRows(data.rows ?? []);
      // Auto-detect columns
      const headers = data.headers ?? [];
      const autoMapping: ColumnMapping = { date: 0, payee: 1, amount: 2 };
      headers.forEach((h: string, i: number) => {
        const lower = h.toLowerCase();
        if (lower.includes("date")) autoMapping.date = i;
        else if (lower.includes("desc") || lower.includes("payee") || lower.includes("name")) autoMapping.payee = i;
        else if (lower.includes("amount") || lower.includes("debit")) autoMapping.amount = i;
        else if (lower.includes("memo") || lower.includes("note")) autoMapping.memo = i;
      });
      setMapping(autoMapping);
      setState("mapping");
      return;
    }

    setBank(data.bank ?? "");
    const parsedTxns = (data.transactions ?? []) as ParsedTransaction[];
    setTransactions(parsedTxns);
    // Select all by default
    const allSelected = new Set(Array.from({ length: parsedTxns.length }, (_, i) => i));
    setSelected(allSelected);

    // Multi-account flow: if any parsed row carries an account name, go to mapping step.
    const distinctAccountNames = Array.from(
      new Set(parsedTxns.map((t) => t.account).filter((s): s is string => !!s))
    );
    if (distinctAccountNames.length >= 1) {
      // Pre-fill mapping by case-insensitive trimmed exact match against Zero account names.
      const prefill: Record<string, string> = {};
      for (const csvAccountName of distinctAccountNames) {
        const match = accounts.find(
          (a) => a.name.trim().toLowerCase() === csvAccountName.trim().toLowerCase()
        );
        if (match) prefill[csvAccountName] = match.id;
      }
      // Launched from a specific account page: use that account as the
      // fallback for any account names that didn't exact-match. CSVs often
      // label the account differently than Zero does (e.g. "Elevations"
      // vs "Elevations (Checking)") — defer to the user's launch intent.
      if (defaultAccountId) {
        for (const csvAccountName of distinctAccountNames) {
          if (!prefill[csvAccountName]) prefill[csvAccountName] = defaultAccountId;
        }
      }
      setAccountMap(prefill);
      setState("accountMapping");
      return;
    }

    setState("preview");

    if (accountId) {
      runDuplicateDetection(accountId, parsedTxns);
    }
  }, [accountId, accounts, defaultAccountId, runDuplicateDetection]);

  const handleApplyMapping = () => {
    const parsed = parseWithMapping(rawHeaders, rawRows, mapping);
    setBank("Custom");
    setTransactions(parsed);
    const allSelected = new Set(Array.from({ length: parsed.length }, (_, i) => i));
    setSelected(allSelected);
    setState("preview");

    if (accountId) {
      runDuplicateDetection(accountId, parsed);
    }
  };

  // Multi-account: run duplicate detection per mapped account group, then go to preview.
  const handleAccountMappingContinue = () => {
    startTransition(async () => {
      const dupeIndices = new Set<number>();
      // Group transactions by their mapped Zero account id, but remember original indices for the global dupe set.
      const groups = new Map<string, { idx: number; txn: ParsedTransaction }[]>();
      transactions.forEach((t, i) => {
        const zeroId = t.account ? accountMap[t.account] : undefined;
        if (!zeroId) return;
        if (!groups.has(zeroId)) groups.set(zeroId, []);
        groups.get(zeroId)!.push({ idx: i, txn: t });
      });

      // DB duplicate checks, scoped per account. A failure here must not strand
      // the user on the account-mapping step with a dead Continue button — fall
      // back to no DB-side flags and still advance to preview below.
      try {
        for (const [zeroId, group] of groups) {
          const dbDupes = await findDuplicates(zeroId, group.map((g) => g.txn));
          // findDuplicates returns indices into the group array — translate back to global indices.
          for (const localIdx of dbDupes) {
            const globalIdx = group[localIdx]?.idx;
            if (globalIdx !== undefined) dupeIndices.add(globalIdx);
          }
        }
      } catch {
        setError("Couldn't check for duplicates — you can still import.");
      }

      // Within-file dupes: same date|payee|amount within the SAME mapped account
      for (const [, group] of groups) {
        const seen = new Map<string, number>();
        for (const { idx, txn } of group) {
          const key = `${txn.date}|${txn.payee.toLowerCase()}|${txn.amount}`;
          if (seen.has(key)) {
            dupeIndices.add(idx);
          } else {
            seen.set(key, idx);
          }
        }
      }

      // Flag only, never auto-deselect — see runDuplicateDetection for why.
      setDuplicates(dupeIndices);
      setState("preview");
    });
  };

  // Run duplicate detection when account changes and we have transactions
  const handleAccountChange = (id: string) => {
    setAccountId(id);
    runDuplicateDetection(id, transactions);
  };

  const toggleRow = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleImport = () => {
    if (selected.size === 0) return;
    const selectedTransactions = transactions.filter((_, i) => selected.has(i));
    const skippedCount = transactions.length - selected.size;

    startTransition(async () => {
      let totalImported = 0;
      let totalCategorized = 0;
      const allSnapshots: TSnapshot[] = [];
      let failed = false;

      try {
        if (isMultiAccount) {
          // Group selected transactions by their mapped Zero account id.
          const groups = new Map<string, ParsedTransaction[]>();
          for (const t of selectedTransactions) {
            const zeroId = t.account ? accountMap[t.account] : undefined;
            if (!zeroId) continue;
            if (!groups.has(zeroId)) groups.set(zeroId, []);
            groups.get(zeroId)!.push(t);
          }
          for (const [zeroId, group] of groups) {
            const res = await onImport(zeroId, group);
            totalImported += res.imported;
            totalCategorized += res.categorized;
            allSnapshots.push(...res.snapshots);
          }
        } else {
          if (!accountId) return;
          const res = await onImport(accountId, selectedTransactions);
          totalImported = res.imported;
          totalCategorized = res.categorized;
          allSnapshots.push(...res.snapshots);
        }
      } catch (e) {
        failed = true;
        // Each account group imports atomically now, so a group that throws
        // saves nothing — totalImported counts only groups that fully landed.
        // For a single account that's zero. Any earlier multi-account groups
        // are already committed, so still say to check before retrying.
        const message = e instanceof Error ? e.message : "something went wrong";
        setError(
          totalImported > 0
            ? `Import failed after ${totalImported} row${
                totalImported === 1 ? "" : "s"
              } from earlier accounts were saved — ${message}. Check your transactions before retrying to avoid duplicates.`
            : `Import failed — ${message}. No rows were saved.`
        );
      }

      // On success, hand every created snapshot up so the caller can offer one
      // Undo for the whole import. Not on the error path: mixing an Undo toast
      // with a failure message is more confusing than the check-and-retry copy.
      if (!failed && allSnapshots.length > 0) {
        onComplete?.(allSnapshots);
      }

      // Land on the summary with the count so far — the full count on success,
      // or the partial count alongside the error above on failure.
      setSummary({ imported: totalImported, categorized: totalCategorized, skipped: skippedCount });
      setState("summary");
    });
  };

  const handleClose = () => {
    setOpen(false);
    // Reset after close animation
    setTimeout(() => {
      setState("idle");
      setTransactions([]);
      setBank("");
      setError(null);
      setSummary(null);
      setDuplicates(new Set());
      setSelected(new Set());
      setRawHeaders([]);
      setRawRows([]);
      setAccountMap({});
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => v ? setOpen(true) : handleClose()}>
      {trigger === "button" && (
        <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
          <Upload className="h-4 w-4" />
          Import CSV
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Account selector — hidden for multi-account flow and after import completes */}
          {!isMultiAccount && state !== "summary" && (
            <Select value={accountId} onValueChange={(v) => handleAccountChange(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select account">
                  {accountId ? accounts.find((a) => a.id === accountId)?.name ?? "Select account" : "Select account"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {sortedAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* File input */}
          {state !== "summary" && (
            <div>
              <label htmlFor="csv-file-input" className="sr-only">Choose CSV file</label>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-accent file:text-accent-foreground hover:file:bg-accent/80"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Field mapping UI */}
          {state === "mapping" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t detect your bank format. Map your columns below:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["date", "payee", "amount", "memo"] as const).map((field) => (
                  <div key={field}>
                    <label className="text-xs font-medium text-muted-foreground capitalize">{field}</label>
                    <Select
                      value={String(field === "memo" ? (mapping.memo ?? "") : mapping[field])}
                      onValueChange={(v) => {
                        if (field === "memo") {
                          setMapping((m) => ({ ...m, memo: v ? Number(v) : undefined }));
                        } else {
                          setMapping((m) => ({ ...m, [field]: Number(v) }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {field === "memo" && mapping.memo === undefined
                            ? "None"
                            : rawHeaders[field === "memo" ? mapping.memo ?? 0 : mapping[field]] ?? "—"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {field === "memo" && (
                          <SelectItem value="">None</SelectItem>
                        )}
                        {rawHeaders.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h || `Column ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {/* Preview first 3 rows with current mapping */}
              {rawRows.length > 0 && (
                <div className="border border-border rounded-md overflow-auto max-h-24">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left p-1.5">Date</th>
                        <th className="text-left p-1.5">Payee</th>
                        <th className="text-right p-1.5">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="p-1.5">{row[mapping.date] ?? "—"}</td>
                          <td className="p-1.5 truncate max-w-[150px]">{row[mapping.payee] ?? "—"}</td>
                          <td className="p-1.5 text-right tabular-nums">{row[mapping.amount] ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="flip-sign"
                  checked={mapping.flipSign ?? false}
                  onChange={(e) => setMapping((m) => ({ ...m, flipSign: e.target.checked }))}
                  className="rounded accent-primary"
                />
                <label htmlFor="flip-sign" className="text-sm text-muted-foreground">
                  Flip amount sign (bank uses positive for expenses)
                </label>
              </div>
              <Button onClick={handleApplyMapping} disabled={!mapping.date && !mapping.payee}>
                Apply mapping
              </Button>
            </div>
          )}

          {/* Account mapping (multi-account exports) */}
          {state === "accountMapping" && distinctCsvAccounts.length > 0 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Map accounts</p>
                <p className="text-xs text-muted-foreground">
                  We found {distinctCsvAccounts.length} account
                  {distinctCsvAccounts.length === 1 ? "" : "s"} in this file. Match each to a Zero account.
                </p>
              </div>
              <div className="space-y-2">
                {distinctCsvAccounts.map((csvAccountName) => (
                  <div key={csvAccountName} className="grid grid-cols-[1fr_1fr] items-center gap-2">
                    <div className="text-sm truncate" title={csvAccountName}>
                      {csvAccountName}
                    </div>
                    <Select
                      value={accountMap[csvAccountName] ?? ""}
                      onValueChange={(v) =>
                        setAccountMap((prev) => ({ ...prev, [csvAccountName]: v ?? "" }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select account">
                          {accountMap[csvAccountName]
                            ? accounts.find((a) => a.id === accountMap[csvAccountName])?.name ?? "Select account"
                            : "Select account"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} align="start">
                        {sortedAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleAccountMappingContinue}
                disabled={
                  isPending ||
                  distinctCsvAccounts.some((n) => !accountMap[n])
                }
              >
                Continue
              </Button>
            </div>
          )}

          {/* Transaction preview */}
          {state === "preview" && transactions.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {bank}: {transactions.length} transactions found
                </p>
                {duplicates.size > 0 && (
                  <p className="text-xs text-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {duplicates.size} possible duplicate{duplicates.size === 1 ? "" : "s"} — uncheck to skip
                  </p>
                )}
              </div>
              <div className="max-h-56 overflow-auto border border-border rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground sticky top-0 bg-background">
                      <th scope="col" className="p-2 w-6">
                        <input
                          type="checkbox"
                          checked={selected.size === transactions.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelected(new Set(Array.from({ length: transactions.length }, (_, i) => i)));
                            } else {
                              setSelected(new Set());
                            }
                          }}
                          className="rounded accent-primary"
                        />
                      </th>
                      <th scope="col" className="text-left p-2">Date</th>
                      <th scope="col" className="text-left p-2">Payee</th>
                      <th scope="col" className="text-left p-2">Category</th>
                      <th scope="col" className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Surface duplicates at the top so they're always visible
                      // even when the list is truncated.
                      const dupeIdxs: number[] = [];
                      const restIdxs: number[] = [];
                      for (let i = 0; i < transactions.length; i++) {
                        (duplicates.has(i) ? dupeIdxs : restIdxs).push(i);
                      }
                      const ordered = [...dupeIdxs, ...restIdxs];
                      const visible = ordered.slice(0, 500);
                      return (
                        <>
                          {visible.map((i) => {
                            const t = transactions[i];
                            const isDuplicate = duplicates.has(i);
                            const isSelected = selected.has(i);
                            const resolved = getResolvedPayee(t);
                            const wasNormalized = resolved.name !== t.payee;
                            return (
                              <tr
                                key={i}
                                // Dim only for deselection. A flagged duplicate still
                                // imports unless the user unchecks it, so dimming it here
                                // would read as "inactive" for a row that's about to land.
                                className={`border-b border-border/50 ${!isSelected ? "opacity-40" : ""}`}
                              >
                                <td className="p-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleRow(i)}
                                    className="rounded accent-primary"
                                  />
                                </td>
                                <td className="p-2">{t.date}</td>
                                <td className="p-2 truncate max-w-[140px]">
                                  {wasNormalized ? resolved.name : t.payee}
                                  {wasNormalized && (
                                    <span className="ml-1 text-[10px] text-muted-foreground" title={t.payee}>
                                      (matched)
                                    </span>
                                  )}
                                  {isDuplicate && (
                                    <span
                                      className="ml-1 text-[10px] text-warning"
                                      title="Same date and amount as an existing transaction. Check the payee — a genuine repeat charge looks identical."
                                    >
                                      (possible duplicate)
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 text-muted-foreground">
                                  {resolved.category ?? "—"}
                                </td>
                                <td className="p-2 text-right tabular-nums zero-amount">
                                  {fmt(t.amount)}
                                </td>
                              </tr>
                            );
                          })}
                          {ordered.length > visible.length && (
                            <tr>
                              <td colSpan={5} className="p-2 text-center text-muted-foreground">
                                ...and {ordered.length - visible.length} more
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              <Button
                onClick={handleImport}
                disabled={isPending || (!isMultiAccount && !accountId) || selected.size === 0}
              >
                {isPending
                  ? "Importing..."
                  : `Import ${selected.size} transaction${selected.size === 1 ? "" : "s"}`}
              </Button>
            </>
          )}

          {/* Import summary */}
          {state === "summary" && summary && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-positive">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Import complete</span>
              </div>
              <div className="space-y-1 text-sm">
                <p>{summary.imported} transaction{summary.imported === 1 ? "" : "s"} imported</p>
                {summary.categorized > 0 && (
                  <p className="text-muted-foreground">
                    {summary.categorized} auto-categorized from learned payees
                  </p>
                )}
                {summary.skipped > 0 && (
                  <p className="text-muted-foreground">
                    {summary.skipped} skipped
                  </p>
                )}
              </div>
              <Button variant="secondary" className="w-full" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
