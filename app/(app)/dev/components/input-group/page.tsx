import { Search, AtSign, DollarSign, Eye } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { PlaygroundShell, Section } from "../_components/playground-shell";

export default function InputGroupPlaygroundPage() {
  return (
    <PlaygroundShell
      title="Input group"
      source="components/ui/input-group.tsx"
      description="Wraps an input with inline or block addons — icons, buttons, prefix/suffix text, even a leading kbd label."
    >
      <Section title="Leading icon" hint="align=inline-start">
        <div className="max-w-md">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search transactions…" />
          </InputGroup>
        </div>
      </Section>

      <Section title="Leading and trailing text">
        <div className="max-w-md">
          <InputGroup>
            <InputGroupAddon>
              <DollarSign />
            </InputGroupAddon>
            <InputGroupInput placeholder="0.00" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>USD</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Section>

      <Section title="Trailing button">
        <div className="max-w-md">
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
        </div>
      </Section>

      <Section title="Block-end addon (textarea)" hint="align=block-end">
        <div className="max-w-md">
          <InputGroup>
            <InputGroupTextarea placeholder="Add a note…" rows={3} />
            <InputGroupAddon align="block-end">
              <InputGroupText>Markdown supported</InputGroupText>
              <InputGroupButton className="ml-auto">Save</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Section>
    </PlaygroundShell>
  );
}
