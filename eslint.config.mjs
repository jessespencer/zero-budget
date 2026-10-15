import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      // Glob rather than one entry per build dir: `.next-a11y/` was missing
      // here for months, and since it's gitignored nobody noticed until
      // `npm run lint` was reporting 6,379 problems -- 59 of the 76 offending
      // files were generated code in that directory. Lint was effectively off
      // locally. Any future `.next-<variant>/` is covered now.
      ".next*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Gitignored, personal historical-import tooling (SEED-018). Same
      // failure as `.next-a11y/` above, one directory over: a CI checkout
      // never contains these files, so linting them locally makes the local
      // warning count disagree with CI's -- and the fix pressure points at
      // frozen one-shot scripts that must never be re-run
      // (`project_historical_db_source_of_truth`). If eslint's scope and
      // git's scope disagree, the lint output stops being a shared number.
      "scripts/historical/**",
      "scripts/import-tracked-asset-history.mjs",
    ],
  },
  // `_foo` means "I know, and I mean it" — a positional arg I have to name to
  // reach the one after it, or a destructured field I'm deliberately dropping.
  // Seven of the warnings this config used to emit were that convention being
  // flagged as a mistake, which is how a warning list stops being read at all.
  // Underscore is opt-in and greppable, so the rule still catches the genuine
  // leftovers.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Privacy/demo mode tripwire: money DISPLAYS must mask when amounts are
  // hidden. Route them through <Currency> or useMaskedCurrency()/
  // useMaskedCurrencyWhole() — importing the raw formatters here means a new
  // surface would silently NOT mask. Non-display uses (undo/aria labels
  // captured at mutation time; masked custom formats that already gate on
  // `hidden`) opt out with `// eslint-disable-next-line no-restricted-imports`.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/format",
              importNames: [
                "formatCurrency",
                "formatCurrencyWhole",
                "formatCurrencyParts",
              ],
              message:
                "Money displays must mask in privacy mode. Use <Currency> or useMaskedCurrency()/useMaskedCurrencyWhole(). For non-display uses (undo/aria labels, or a custom format already gated on `hidden`), add an eslint-disable-next-line with a note why.",
            },
          ],
        },
      ],
    },
  },
  // The import rule above only stops you reaching for OUR raw formatters. It
  // did nothing about hand-rolling a new one, which is exactly how /quick ended
  // up leaking real amounts in privacy mode: `lib/quick-add-utils.ts` defined
  // its own `formatAmount` via `toLocaleString({style:"currency"})` and the
  // Recent list rendered plaintext dollars while the inputs beside it masked.
  // Note `lib/**` is in scope here — that file sat outside the import rule's
  // globs entirely, so it was missed twice over.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'] Property[key.name='style'][value.value='currency']",
          message:
            "Hand-rolled currency formatter. It won't mask in privacy mode. Use <Currency> or useMaskedCurrency()/useMaskedCurrencyWhole() instead.",
        },
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat'] Property[key.name='style'][value.value='currency']",
          message:
            "Currency Intl.NumberFormat belongs in lib/format.ts behind the masking layer, not at the callsite. Use <Currency> or useMaskedCurrency().",
        },
      ],
    },
  },
  // The sanctioned home of the raw formatters — the masking layer itself.
  {
    files: [
      "lib/format.ts",
      "components/shared/currency.tsx",
      "components/shared/use-masked-currency.ts",
    ],
    rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" },
  },
];

export default eslintConfig;
