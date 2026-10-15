import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlaygroundShell, Section } from "../_components/playground-shell";

const rows = [
  { date: "Jun 8", payee: "Whole Foods", category: "Groceries", amount: -84.21 },
  { date: "Jun 7", payee: "Shell", category: "Gas", amount: -52.4 },
  { date: "Jun 6", payee: "Starbucks", category: "Dining", amount: -6.35 },
  { date: "Jun 5", payee: "Paycheck", category: "Income", amount: 3240 },
  { date: "Jun 4", payee: "Amazon", category: "Shopping", amount: -41.0 },
];

const total = rows.reduce((sum, r) => sum + r.amount, 0);

export default function TablePlaygroundPage() {
  return (
    <PlaygroundShell
      title="Table"
      source="components/ui/table.tsx"
      description="Table primitives — header, body, footer, row, head, cell. Rows hover and support data-state=selected."
      maxWidth="wide"
    >
      <Section title="Default" contentClassName="p-0">
        <Table>
          <TableCaption>5 most recent transactions.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{r.date}</TableCell>
                <TableCell>{r.payee}</TableCell>
                <TableCell className="text-muted-foreground">{r.category}</TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    r.amount < 0 ? "text-negative" : "text-positive"
                  }`}
                >
                  {r.amount.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Net</TableCell>
              <TableCell className="text-right tabular-nums">
                {total.toFixed(2)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Section>

      <Section title="Selected row" hint="data-state=selected" contentClassName="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 3).map((r, i) => (
              <TableRow key={i} data-state={i === 1 ? "selected" : undefined}>
                <TableCell className="text-muted-foreground">{r.date}</TableCell>
                <TableCell>{r.payee}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amount.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </PlaygroundShell>
  );
}
