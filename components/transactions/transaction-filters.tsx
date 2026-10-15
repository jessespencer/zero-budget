"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TransactionFiltersProps = {
  accounts: { id: string; name: string }[];
};

export function TransactionFilters({ accounts }: TransactionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`?${params.toString()}`);
  };

  const accountParam = searchParams.get("account");
  const selectedAccount = accountParam ? accounts.find((a) => a.id === accountParam) : null;

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
      <Input
        placeholder="Search payee or memo..."
        className="max-w-xs h-8 text-sm"
        defaultValue={searchParams.get("search") ?? ""}
        onChange={(e) => {
          // Debounce search
          const value = e.target.value;
          const timeout = setTimeout(() => updateParam("search", value), 300);
          return () => clearTimeout(timeout);
        }}
      />
      <Select
        value={accountParam ?? "all"}
        onValueChange={(v) => updateParam("account", v ?? "all")}
      >
        <SelectTrigger className="w-48 h-8 text-sm">
          <SelectValue placeholder="All accounts">
            {selectedAccount ? selectedAccount.name : "All accounts"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
