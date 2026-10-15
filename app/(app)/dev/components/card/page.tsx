import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function CardPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Card"
      source="components/ui/card.tsx"
      description="Container with header/content/footer slots. Footer auto-styles as a bottom bar. Two sizes (default · sm)."
    >
      <Section title="Default with all slots">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Account balance</CardTitle>
            <CardDescription>Real-time across all checking accounts.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm">
                Refresh
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">$12,847.50</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Last updated 3 minutes ago
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm">
              View transactions
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Small size" hint="size=sm">
        <Card size="sm" className="max-w-md">
          <CardHeader>
            <CardTitle>Quick stat</CardTitle>
            <CardDescription>Tighter padding, smaller title.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold tabular-nums">$1,234.00</div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Header only">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Title only</CardTitle>
            <CardDescription>No body, no footer — common for empty-state shells.</CardDescription>
          </CardHeader>
        </Card>
      </Section>
    </PlaygroundShell>
  );
}
