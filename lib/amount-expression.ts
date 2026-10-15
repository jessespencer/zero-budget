/**
 * Arithmetic in amount inputs (SEED-024) — typing `12.50 + 3` and getting
 * `15.50`. Pure and dependency-free so every amount field can share it: /quick
 * proves it first, the budget assign cell and transaction amount follow.
 *
 * Supports `+ - * /` with normal precedence (× and ÷ bind tighter), plus the
 * glyphs a phone keyboard or a paste is likely to produce (`× x ÷ −`). `$` and
 * thousands commas are ignored. No parentheses, no unary minus — an amount
 * field never needs them, and refusing them keeps a typo from silently
 * becoming a different number.
 *
 * Floats are summed raw and only the final value is snapped to cents, per the
 * money rule in CLAUDE.md (never round intermediate sums).
 */

export type AmountOperator = "+" | "-" | "*" | "/";

type Token = number | AmountOperator;

const OPERATOR_ALIASES: Record<string, AmountOperator> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  x: "*",
  X: "*",
  "/": "/",
  "÷": "/",
};

export function toAmountOperator(char: string): AmountOperator | null {
  return OPERATOR_ALIASES[char] ?? null;
}

function tokenize(input: string): Token[] | null {
  // Whitespace separates tokens rather than being stripped, so "12 3" is two
  // numbers (rejected) and not 123.
  const cleaned = input.replace(/[$,]/g, "");

  const tokens: Token[] = [];
  let i = 0;
  while (i < cleaned.length) {
    if (/\s/.test(cleaned[i])) {
      i += 1;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)/.exec(cleaned.slice(i));
    if (number) {
      tokens.push(Number(number[0]));
      i += number[0].length;
      continue;
    }
    const op = toAmountOperator(cleaned[i]);
    if (!op) return null;
    tokens.push(op);
    i += 1;
  }
  return tokens.length > 0 ? tokens : null;
}

/**
 * Evaluate an amount expression to a cent-snapped number, or `null` when the
 * input isn't a well-formed expression (empty, stray characters, two operators
 * in a row, a trailing operator, division by zero). A bare number is a valid
 * expression and evaluates to itself.
 */
export function evaluateAmountExpression(input: string): number | null {
  const tokens = tokenize(input);
  if (!tokens) return null;

  // Strict alternation: number, op, number, … , number.
  if (tokens.length % 2 === 0) return null;
  for (let i = 0; i < tokens.length; i++) {
    const isNumber = typeof tokens[i] === "number";
    if (isNumber !== (i % 2 === 0)) return null;
  }

  // Fold × and ÷ into their left operand, leaving a sum of signed terms.
  const terms: number[] = [tokens[0] as number];
  const signs: (1 | -1)[] = [1];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i] as AmountOperator;
    const value = tokens[i + 1] as number;
    if (op === "*") {
      terms[terms.length - 1] *= value;
    } else if (op === "/") {
      if (value === 0) return null;
      terms[terms.length - 1] /= value;
    } else {
      terms.push(value);
      signs.push(op === "+" ? 1 : -1);
    }
  }

  const total = terms.reduce((sum, term, i) => sum + signs[i] * term, 0);
  if (!Number.isFinite(total)) return null;
  // `+ 0` normalises -0 so a zero result never renders as "-0.00".
  return Math.round(total * 100) / 100 + 0;
}
