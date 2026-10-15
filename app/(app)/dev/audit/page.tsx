"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  AtSign,
  Check,
  ChevronLeft,
  CircleCheck,
  Copy,
  DollarSign,
  Eye,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup } from "@/components/ui/field-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";

import { Currency } from "@/components/shared/currency";
import { DateInput } from "@/components/shared/date-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AccountCombobox } from "@/components/shared/account-combobox";
import { CategoryCombobox } from "@/components/shared/category-combobox";
import { PayeeCombobox } from "@/components/shared/payee-combobox";
import { MonthSelector } from "@/components/shared/month-selector";
import { YearSelector } from "@/components/shared/year-selector";
import {
  UncategorizedBanner,
  UncategorizedFilterActive,
} from "@/components/shared/uncategorized-banner";

import { cn } from "@/lib/utils";

// --- fixtures ----------------------------------------------------------------

const accountFixtures = [
  { id: "chase", name: "Chase Checking" },
  { id: "amex", name: "Amex Gold" },
  { id: "schwab", name: "Schwab Savings" },
  { id: "vanguard", name: "Vanguard Brokerage" },
  { id: "venmo", name: "Venmo" },
];

const categoryGroupFixtures = [
  {
    id: "essentials",
    name: "Essentials",
    items: [
      { id: "rent", name: "Rent" },
      { id: "groceries", name: "Groceries" },
      { id: "utilities", name: "Utilities" },
    ],
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    items: [
      { id: "dining", name: "Dining out" },
      { id: "travel", name: "Travel" },
    ],
  },
];

const incomeFixtures = [
  { id: "paycheck", name: "Paycheck" },
  { id: "interest", name: "Interest" },
];

const payeeFixtures = [
  { id: "1", name: "Whole Foods", default_category_id: "groceries" },
  { id: "2", name: "Amazon", default_category_id: null },
  { id: "3", name: "Shell", default_category_id: null },
];

// --- audit groups (top of file table of contents) ----------------------------

const toc = [
  { id: "actions", label: "Actions & buttons" },
  { id: "form-fields", label: "Form fields (height/border audit)" },
  { id: "pickers", label: "Pickers & comboboxes" },
  { id: "status", label: "Status & data" },
  { id: "overlays", label: "Overlays" },
  { id: "navigation", label: "Navigation" },
  { id: "banners", label: "Banners" },
  { id: "empty-states", label: "Empty states" },
];

// --- shell -------------------------------------------------------------------

function Group({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <header className="border-b border-border pb-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </header>
      <div className="mt-4 flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Row({
  label,
  source,
  children,
  inset,
}: {
  label: string;
  source?: string;
  children: React.ReactNode;
  inset?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-accent/40 px-3 py-1.5">
        <span className="text-xs font-medium">{label}</span>
        {source && (
          <span className="font-mono text-[10px] text-muted-foreground">{source}</span>
        )}
      </div>
      <div className={cn(inset ? "" : "p-4")}>{children}</div>
    </div>
  );
}

// --- page --------------------------------------------------------------------

export default function AuditPage() {
  const { toast } = useToast();

  // form-fields state
  const [text, setText] = useState("");
  const [textarea, setTextarea] = useState("");
  const [date, setDate] = useState("2026-06-09");
  const [selectVal, setSelectVal] = useState<string | null>("chase");
  const [switchOn, setSwitchOn] = useState(true);

  // pickers state
  const [accountVal, setAccountVal] = useState("chase");
  const [categoryVal, setCategoryVal] = useState("groceries");
  const [payeeVal, setPayeeVal] = useState("Whole Foods");

  // overlays state
  const [confirmOpen, setConfirmOpen] = useState(false);

  // banner state
  const [uncatCount, setUncatCount] = useState(12);
  const [uncatActive, setUncatActive] = useState(false);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link
        href="/dev"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to dev
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Component audit</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every component actually imported by app code, grouped so visual
        inconsistencies (heights, radii, hover backgrounds, typography) are easy
        to spot. Skips the nine primitives with zero prod imports.
      </p>

      {/* sticky TOC */}
      <nav className="sticky top-2 z-10 mt-4 -mx-2 flex flex-wrap gap-1 rounded-lg bg-card/80 p-1.5 ring-1 ring-border backdrop-blur">
        {toc.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="mt-8 flex flex-col gap-12">
        {/* ACTIONS & BUTTONS */}
        <Group
          id="actions"
          title="Actions & buttons"
          hint="Compare radii, heights, icon padding, hover bg. Pill radius should be uniform across all sizes."
        >
          <Row label="Button — every variant" source="components/ui/button.tsx">
            <div className="flex flex-wrap items-center gap-3">
              <Button>default</Button>
              <Button variant="outline">outline</Button>
              <Button variant="secondary">secondary</Button>
              <Button variant="ghost">ghost</Button>
              <Button variant="destructive">destructive</Button>
              <Button variant="link">link</Button>
            </div>
          </Row>

          <Row label="Button — every size" source="components/ui/button.tsx">
            <div className="flex flex-wrap items-end gap-3">
              <Button size="xs">xs</Button>
              <Button size="sm">sm</Button>
              <Button size="default">default</Button>
              <Button size="lg">lg</Button>
              <Button size="icon-xs" aria-label="icon-xs">
                <Plus />
              </Button>
              <Button size="icon-sm" aria-label="icon-sm">
                <Plus />
              </Button>
              <Button size="icon" aria-label="icon">
                <Plus />
              </Button>
              <Button size="icon-lg" aria-label="icon-lg">
                <Plus />
              </Button>
            </div>
          </Row>

          <Row label="Button — with icons" source="components/ui/button.tsx">
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Plus data-icon="inline-start" />
                Add expense
              </Button>
              <Button variant="outline">
                Continue
                <ArrowRight data-icon="inline-end" />
              </Button>
              <Button variant="destructive">
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            </div>
          </Row>

          <Row label="Button — disabled" source="components/ui/button.tsx">
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>default</Button>
              <Button variant="outline" disabled>
                outline
              </Button>
              <Button variant="destructive" disabled>
                destructive
              </Button>
              <Button variant="ghost" disabled>
                ghost
              </Button>
            </div>
          </Row>
        </Group>

        {/* FORM FIELDS — visual alignment audit */}
        <Group
          id="form-fields"
          title="Form fields"
          hint="All field-shaped inputs in one stack so heights, borders, radii, and focus rings can be compared at a glance."
        >
          <Row label="Side-by-side — h-8 should match across the row">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldGroup label="Input">
                <Input
                  placeholder="Type here…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="Select">
                <Select value={selectVal} onValueChange={(v) => setSelectVal(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accountFixtures.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
              <FieldGroup label="DateInput">
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </FieldGroup>
              <FieldGroup label="InputGroup">
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput placeholder="Search…" />
                </InputGroup>
              </FieldGroup>
              <FieldGroup label="InputGroup — trailing button">
                <InputGroup>
                  <InputGroupAddon>
                    <AtSign />
                  </InputGroupAddon>
                  <InputGroupInput type="password" placeholder="password" />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="Reveal">
                      <Eye />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </FieldGroup>
              <FieldGroup label="InputGroup — amount">
                <InputGroup>
                  <InputGroupAddon>
                    <DollarSign />
                  </InputGroupAddon>
                  <InputGroupInput placeholder="0.00" />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>USD</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </FieldGroup>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              ⚠ DateInput is h-10 in source; Input/Select/InputGroup are h-8. Comparing them side-by-side surfaces the mismatch.
            </div>
          </Row>

          <Row label="Textarea + Switch + states">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldGroup label="Textarea" optional>
                <Textarea
                  rows={3}
                  placeholder="Add a note…"
                  value={textarea}
                  onChange={(e) => setTextarea(e.target.value)}
                />
              </FieldGroup>
              <div className="flex flex-col gap-3">
                <FieldGroup label="Switch">
                  <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
                </FieldGroup>
                <FieldGroup label="Disabled input">
                  <Input defaultValue="Read-only" disabled />
                </FieldGroup>
                <FieldGroup label="Invalid input">
                  <Input defaultValue="bad@input" aria-invalid />
                </FieldGroup>
              </div>
            </div>
          </Row>
        </Group>

        {/* PICKERS — comboboxes */}
        <Group
          id="pickers"
          title="Pickers & comboboxes"
          hint="All three comboboxes side by side — chrome, chevron, clear button, and dropdown surface should match."
        >
          <Row label="AccountCombobox · CategoryCombobox · PayeeCombobox">
            <div className="grid gap-3 sm:grid-cols-3">
              <FieldGroup label="Account">
                <AccountCombobox
                  value={accountVal}
                  accounts={accountFixtures}
                  onChange={setAccountVal}
                />
              </FieldGroup>
              <FieldGroup label="Category">
                <CategoryCombobox
                  value={categoryVal}
                  groupedCategories={categoryGroupFixtures}
                  incomeCategories={incomeFixtures}
                  onChange={setCategoryVal}
                  onSplit={() => toast({ message: "Split clicked" })}
                />
              </FieldGroup>
              <FieldGroup label="Payee">
                <PayeeCombobox
                  value={payeeVal}
                  payees={payeeFixtures}
                  onChange={(name) => setPayeeVal(name)}
                />
              </FieldGroup>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              ⚠ Comboboxes are h-10 (built-in) while shared Input is h-8 — easy to spot when stacked next to FieldGroup&apos;d inputs above.
            </div>
          </Row>
        </Group>

        {/* STATUS & DATA */}
        <Group
          id="status"
          title="Status & data"
          hint="Badges, currency formatting, tooltip — quick scan for typography and color-token consistency."
        >
          <Row label="Badge — every intent" source="components/ui/badge.tsx">
            <div className="flex flex-wrap items-center gap-2">
              <Badge intent="neutral">neutral</Badge>
              <Badge intent="positive">
                <Check />
                positive
              </Badge>
              <Badge intent="negative">
                <X />
                negative
              </Badge>
              <Badge intent="warning">
                <AlertTriangle />
                warning
              </Badge>
              <Badge intent="info">
                <Info />
                info
              </Badge>
              <Badge intent="brand">brand</Badge>
            </div>
          </Row>

          <Row label="Currency — sign drives color" source="components/shared/currency.tsx">
            <div className="flex flex-wrap items-center gap-6 text-2xl">
              <Currency amount={12847.5} />
              <Currency amount={0} />
              <Currency amount={-84.21} />
              <Currency amount={1234567.89} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-6 text-sm">
              <Currency amount={12847.5} />
              <Currency amount={0} />
              <Currency amount={-84.21} />
              <span className="text-muted-foreground">smaller scale (text-sm)</span>
            </div>
          </Row>

          <Row label="Tooltip" source="components/ui/tooltip.tsx">
            <TooltipProvider>
              <div className="flex flex-wrap items-center gap-3">
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline">top</Button>} />
                  <TooltipContent side="top">top</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline">right</Button>} />
                  <TooltipContent side="right">right</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline">bottom</Button>} />
                  <TooltipContent side="bottom">bottom</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline">left</Button>} />
                  <TooltipContent side="left">left</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </Row>
        </Group>

        {/* OVERLAYS */}
        <Group
          id="overlays"
          title="Overlays"
          hint="Open each — Dialog/Sheet/Popover/Dropdown should share the same popover surface tokens (bg-popover, rounded-2xl, shadow-lg, ring)."
        >
          <Row label="Dialog · Sheet · Popover · Dropdown · Confirm">
            <div className="flex flex-wrap items-center gap-3">
              <Dialog>
                <DialogTrigger render={<Button>Dialog</Button>} />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit account</DialogTitle>
                    <DialogDescription>
                      Update the account name. Changes apply across all transactions.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <FieldGroup label="Name">
                      <Input defaultValue="Chase Checking" />
                    </FieldGroup>
                  </div>
                  <DialogFooter showCloseButton>
                    <Button>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Sheet>
                <SheetTrigger render={<Button variant="outline">Sheet</Button>} />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Sheet panel</SheetTitle>
                    <SheetDescription>Right-anchored drawer.</SheetDescription>
                  </SheetHeader>
                  <div className="px-4 text-sm">Body content.</div>
                </SheetContent>
              </Sheet>

              <Popover>
                <PopoverTrigger render={<Button variant="outline">Popover</Button>} />
                <PopoverContent>
                  <PopoverHeader>
                    <PopoverTitle>Heads up</PopoverTitle>
                    <PopoverDescription>Non-modal popover.</PopoverDescription>
                  </PopoverHeader>
                  <div className="text-sm">Content lives here.</div>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline">
                      Dropdown
                      <MoreHorizontal data-icon="inline-end" />
                    </Button>
                  }
                />
                <DropdownMenuContent>
                  <DropdownMenuItem>
                    <Pencil /> Edit
                    <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
                ConfirmDialog
              </Button>
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Delete account?"
                description="This removes the account and all 247 transactions. Can't be undone."
                confirmLabel="Delete account"
                onConfirm={() => toast({ message: "Deleted (preview)" })}
              />
            </div>
          </Row>

          <Row label="Toast — trigger each variant" source="components/ui/toast.tsx">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => toast({ message: "Transaction deleted", action: { label: "Undo", onClick: () => {} } })}
              >
                default + undo
              </Button>
              <Button
                variant="outline"
                onClick={() => toast({ message: "Saved", variant: "success", duration: 2500 })}
              >
                success
              </Button>
              <Button
                variant="outline"
                onClick={() => toast({ message: "Could not save — try again", variant: "error", duration: 2500 })}
              >
                error
              </Button>
            </div>
          </Row>
        </Group>

        {/* NAVIGATION */}
        <Group
          id="navigation"
          title="Navigation"
          hint="Tabs and month/year selectors as they appear in the budget/insights page headers."
        >
          <Row label="Tabs — default variant">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="trends">Trends</TabsTrigger>
                <TabsTrigger value="net-worth">Net worth</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="rounded-lg border bg-card p-4">
                Overview content.
              </TabsContent>
              <TabsContent value="trends" className="rounded-lg border bg-card p-4">
                Trends content.
              </TabsContent>
              <TabsContent value="net-worth" className="rounded-lg border bg-card p-4">
                Net worth content.
              </TabsContent>
            </Tabs>
          </Row>

          <Row label="Tabs — line variant">
            <Tabs defaultValue="all">
              <TabsList variant="line">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="cleared">Cleared</TabsTrigger>
                <TabsTrigger value="uncleared">Uncleared</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="rounded-lg border bg-card p-4">
                All.
              </TabsContent>
              <TabsContent value="cleared" className="rounded-lg border bg-card p-4">
                Cleared.
              </TabsContent>
              <TabsContent value="uncleared" className="rounded-lg border bg-card p-4">
                Uncleared.
              </TabsContent>
            </Tabs>
          </Row>

          <Row label="MonthSelector — in page header chrome" inset>
            <div className="flex h-[88px] items-center bg-accent/40 px-6">
              <MonthSelector />
            </div>
          </Row>

          <Row label="YearSelector — in page header chrome" inset>
            <div className="flex h-[88px] items-center bg-accent/40 px-6">
              <YearSelector label="overview" />
            </div>
          </Row>
        </Group>

        {/* BANNERS */}
        <Group
          id="banners"
          title="Banners"
          hint="All three banners back-to-back so warning intent, padding, and trailing CTA chip can be compared."
        >
          <Row label="UncategorizedBanner" inset>
            <UncategorizedBanner count={uncatCount} onView={() => setUncatActive(true)} />
            <div className="flex items-center gap-2 px-4 py-3 text-xs">
              <span className="text-muted-foreground">Count</span>
              <input
                type="number"
                min={0}
                value={uncatCount}
                onChange={(e) => setUncatCount(Number(e.target.value))}
                className="h-7 w-20 rounded-md border border-border bg-card px-2"
              />
              <span className="text-muted-foreground">(0 hides the banner)</span>
            </div>
          </Row>

          <Row label="UncategorizedFilterActive" inset>
            {uncatActive ? (
              <UncategorizedFilterActive onClear={() => setUncatActive(false)} />
            ) : (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Click View on the banner above to flip into this state.
              </div>
            )}
          </Row>

          <Row label="DevModeBanner — visual repro (env-gated in prod)" inset>
            <div
              role="status"
              aria-label="Development mode (preview)"
              className="flex h-6 items-center justify-center gap-3 bg-amber-300 px-3 text-[11px] text-amber-950"
            >
              <span className="font-semibold uppercase tracking-wider">Dev mode</span>
              <span className="tabular-nums opacity-80">zero.db</span>
            </div>
          </Row>
        </Group>

        {/* EMPTY STATES */}
        <Group
          id="empty-states"
          title="Empty states"
          hint="Inline variant only — page variant takes over the screen. See /dev/empty-states for the full set."
        >
          <Row label="Inline" inset>
            <EmptyState
              icon={ArrowLeftRight}
              message="No transactions match these filters."
              primaryAction={{ label: "Clear filters", onClick: () => {} }}
            />
          </Row>

          <Row label="Inline — all clear" inset>
            <EmptyState
              icon={CircleCheck}
              message="Nothing left to categorize — you're all caught up."
              primaryAction={{ label: "Clear filter", onClick: () => {} }}
            />
          </Row>
        </Group>

        {/* footer note */}
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          Not shown — zero prod imports:{" "}
          <span className="font-mono">
            Card · Collapsible · Command · Progress · ScrollArea · Separator · Table ·
            PageToolbar · ThemeToggle
          </span>
          . Per-component playgrounds for these remain at{" "}
          <Link href="/dev/components" className="underline">
            /dev/components
          </Link>{" "}
          if you want to consider adopting them.
        </div>
      </div>
    </div>
  );
}
