import { Actor, log } from 'apify';

import { askLlm } from './ask-llm.ts';
import { calculate } from './calculate.ts';
import { buildHtml, buildRows } from './report.ts';
import type { Input, YearParams } from './types.ts';
import { params2025 } from './years/2025.ts';

const YEARS: Record<string, YearParams> = { 2025: params2025 };

await Actor.init();

const input = await Actor.getInputOrThrow<Input>();
const params = YEARS[input.taxYear];
if (!params) {
    throw new Error(`Tax year ${input.taxYear} has no approved parameters yet. Supported: ${Object.keys(YEARS)}.`);
}
if (input.expenseMode === 'actual' && input.actualExpenses === undefined) {
    throw new Error('Actual expenses were selected, but "actualExpenses" is missing.');
}

const language = input.language ?? 'en';
const calculation = calculate(input, params);
if ((calculation.tax.profit ?? 0) < 0) {
    log.warning('Your expenses exceed your income (ztráta). Loss carry-forward is not supported, '
        + 'the tax rows treat it as 0.');
}

const rows = buildRows(params, calculation, language);
const answer = input.notes?.trim() ? await askLlm(input.notes, params, calculation, language) : null;

await Actor.pushData(rows);
await Actor.setValue('CALCULATION', { year: params.year, ...calculation, answer });
await Actor.setValue('OUTPUT', buildHtml(params, calculation, rows, language, input.notes, answer), {
    contentType: 'text/html',
});

log.info(`Done. DPFO balance ${calculation.tax.taxBalance} Kč, ČSSZ ${calculation.social.socialBalance} Kč, `
    + `VZP ${calculation.health.healthBalance} Kč. Open the OUTPUT record for the full report.`);

await Actor.exit();
