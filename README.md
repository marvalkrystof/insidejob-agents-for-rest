# OSVČ Forms Helper (CZ)

An Apify Actor that helps a Czech freelancer (OSVČ) with the three annual filings:

- **Daňové přiznání k dani z příjmů FO** (form 25 5405 + Příloha č. 1)
- **Přehled o příjmech a výdajích OSVČ** for ČSSZ
- **Přehled OSVČ** for VZP

You enter your numbers and the Actor returns every form row you need to fill in. Each row has its value, a plain-language explanation (English or Czech), how the value was calculated and the official source it relies on. You also get a "what to do next" list with amounts to pay, new monthly advances and deadlines.

## How it stays reliable

- **Deterministic math.** All numbers come from TypeScript code (`src/calculate.ts`) driven by a per-year parameter file (`src/years/2025.ts`). The LLM never calculates or changes a number.
- **Every value is cited.** Each rate, limit, minimum and deadline in the year file links to an official source (financnisprava.gov.cz, cssz.gov.cz, eportal.cssz.cz, vzp.cz, e-sbirka.gov.cz) with a quote.
- **Frozen explanations.** Row explanations are written once per year from the official pokyny and reviewed in the PR. They are not generated at runtime.
- **Golden tests.** `npm test` checks the calculator against hand-calculated cases. A year's parameters are approved by merging them with passing tests.
- **LLM only for your questions.** If you add notes, an open-weight model on [Featherless](https://featherless.ai) (`Qwen/Qwen3.8-27B`) answers them only from the approved rows and calculation trace, cites rows, and flags situations the tool doesn't support.
- **No personal data.** Name, rodné číslo, DIČ, address and bank account are never collected. You fill those in yourself.

## Supported scope (tax year 2025)

Full-year OSVČ with only §7 business income, main (hlavní) or secondary (vedlejší) activity, flat-rate (paušální) or actual expenses, sleva na poplatníka, children claimed for the whole year, health insurer VZP.

Not supported: §6 employment income in the same return, §8/§9/§10 or foreign income, spolupracující osoba, part-year activity, odpočty (mortgage interest, pension savings, gifts), paušální daň, DPH, a loss (ztráta), other health insurers' row numbers, and a higher voluntary ČSSZ base.

## Input

See `.actor/input_schema.json`. The required fields are `taxYear`, `activityType`, `income` and `expenseMode`. Notes are optional free text.

## Output

- **Dataset:** one item per form row (`form`, `row`, `label`, `value`, `explanation`, `calculation`, `sourceUrl`, `sourceQuote`).
- **Key-value store `OUTPUT`:** an HTML report with all three forms, the action plan and deadlines.
- **Key-value store `CALCULATION`:** the full calculation trace and the LLM's answer.

## Development

```bash
npm install
npm test           # golden tests
npm run build
apify run          # uses storage/key_value_stores/default/INPUT.json
```

The Q&A needs `FEATHERLESS_API_KEY` (from https://featherless.ai/account/api-keys). On the platform, set the secret with `apify secrets add featherlessApiKey <key>`. Without the key, the Actor skips the questions section. The model is set in `src/ask-llm.ts`.

## Adding a new tax year

1. Copy `src/years/2025.ts` to `src/years/<year>.ts` and update every value, row number, label, explanation and source from that year's official forms and pokyny.
2. Add golden test cases for the year.
3. Register the year in `src/main.ts` and in the `taxYear` enum in the input schema.
4. Merge only after reviewing the diff against the previous year.

Roadmap: automated draft of the next year's file (scrape the official forms, LLM draft, human approval), odpočty, other health insurers, EPO XML export, calendar export.
