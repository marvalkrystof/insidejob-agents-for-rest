import type { Calculation, FormId, Language, RowDef, YearParams } from './types.ts';

export type ReportRow = {
    form: FormId;
    row: string;
    label: string;
    value: number;
    explanation: string;
    calculation: string;
    sourceUrl: string;
    sourceQuote: string;
};

const FORM_TITLES: Record<FormId, string> = {
    dpfo: 'Daňové přiznání k dani z příjmů FO (Finanční správa)',
    cssz: 'Přehled o příjmech a výdajích OSVČ (ČSSZ)',
    vzp: 'Přehled o příjmech a výdajích OSVČ (VZP)',
};

const FORM_VALUES: Record<FormId, 'tax' | 'social' | 'health'> = { dpfo: 'tax', cssz: 'social', vzp: 'health' };

const EN = {
        title: 'Your OSVČ filings',
        row: 'Row',
        value: 'Value (Kč)',
        meaning: 'What it means',
        how: 'How it was calculated',
        next: 'What to do next',
        toPay: 'to pay',
        refund: 'overpaid / refund',
        newAdvance: 'New monthly advance',
        deadlines: 'Deadlines',
        questions: 'Your questions',
        identity: 'Personal details (name, rodné číslo, DIČ, address, bank account) are not collected. '
            + 'Fill them in yourself.',
        disclaimer: 'Calculated from the officially published rules for this year, with sources for every row. '
            + 'It is not tax advice: check the values before you submit, and ask a daňový poradce if your situation '
            + 'is outside the supported scope.',
};

const UI: Record<Language, typeof EN> = {
    en: EN,
    cs: {
        title: 'Vaše podání OSVČ',
        row: 'Řádek',
        value: 'Hodnota (Kč)',
        meaning: 'Co to znamená',
        how: 'Jak se to spočítalo',
        next: 'Co dál',
        toPay: 'doplatit',
        refund: 'přeplatek',
        newAdvance: 'Nová měsíční záloha',
        deadlines: 'Termíny',
        questions: 'Vaše dotazy',
        identity: 'Osobní údaje (jméno, rodné číslo, DIČ, adresu, číslo účtu) nesbíráme. Doplňte je sami.',
        disclaimer: 'Spočítáno podle oficiálně zveřejněných pravidel pro daný rok, u každého řádku je zdroj. '
            + 'Nejde o daňové poradenství: hodnoty před podáním zkontrolujte a pokud vaše situace přesahuje '
            + 'podporovaný rozsah, obraťte se na daňového poradce.',
    },
};

const escapeHtml = (text: string): string => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const formatKc = (value: number): string => value.toLocaleString('cs-CZ');

export const buildRows = (params: YearParams, calculation: Calculation, language: Language): ReportRow[] => {
    const formulas = new Map(calculation.trace.map((step) => [step.key, step.formula]));

    return params.rows.map((def: RowDef) => ({
        form: def.form,
        row: def.row,
        label: def.label,
        value: calculation[FORM_VALUES[def.form]][def.key] ?? 0,
        explanation: def.explanation[language],
        calculation: formulas.get(def.key) ?? '',
        sourceUrl: def.source.url,
        sourceQuote: def.source.quote,
    }));
};

const balanceLine = (label: string, value: number, ui: typeof EN): string => (
    `<li><strong>${escapeHtml(label)}:</strong> ${formatKc(Math.abs(value))} Kč `
    + `${value >= 0 ? ui.toPay : ui.refund}</li>`
);

export const buildHtml = (
    params: YearParams,
    calculation: Calculation,
    rows: ReportRow[],
    language: Language,
    answer: string | null,
): string => {
    const ui = UI[language];
    const tables = (Object.keys(FORM_TITLES) as FormId[]).map((form) => `
        <h2>${escapeHtml(FORM_TITLES[form])}</h2>
        <table>
            <thead><tr><th>${ui.row}</th><th>${ui.value}</th><th>${ui.meaning}</th><th>${ui.how}</th></tr></thead>
            <tbody>${rows.filter((row) => row.form === form).map((row) => `
                <tr>
                    <td><strong>${escapeHtml(row.row)}</strong><br>
                        <span class="label">${escapeHtml(row.label)}</span></td>
                    <td class="num">${formatKc(row.value)}</td>
                    <td>${escapeHtml(row.explanation)}<br>
                        <a href="${escapeHtml(row.sourceUrl)}" title="${escapeHtml(row.sourceQuote)}">source</a></td>
                    <td class="how">${escapeHtml(row.calculation)}</td>
                </tr>`).join('')}
            </tbody>
        </table>`).join('');

    const deadlines = params.deadlines.map((deadline) => `
        <li><strong>${escapeHtml(deadline.date)}</strong>: ${escapeHtml(deadline.what[language])}
            (<a href="${escapeHtml(deadline.source.url)}">source</a>)</li>`).join('');

    return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ui.title} ${params.year}</title>
<style>
    body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 16px; color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .label, .how { color: #555; font-size: 0.9em; }
    .note { background: #f5f5f5; padding: 12px; border-radius: 6px; }
    pre { white-space: pre-wrap; font-family: inherit; }
</style>
</head>
<body>
<h1>${ui.title} ${params.year}</h1>
<p class="note">${escapeHtml(ui.identity)}</p>
${tables}
<h2>${ui.next}</h2>
<ul>
    ${balanceLine('DPFO', calculation.tax.taxBalance ?? 0, ui)}
    ${balanceLine('ČSSZ', calculation.social.socialBalance ?? 0, ui)}
    ${balanceLine('VZP', calculation.health.healthBalance ?? 0, ui)}
    <li><strong>${ui.newAdvance} ČSSZ:</strong> ${formatKc(calculation.social.socialNewAdvance ?? 0)} Kč</li>
    <li><strong>${ui.newAdvance} VZP:</strong> ${formatKc(calculation.health.healthNewAdvance ?? 0)} Kč</li>
</ul>
<h3>${ui.deadlines}</h3>
<ul>${deadlines}</ul>
${answer ? `<h2>${ui.questions}</h2><pre>${escapeHtml(answer)}</pre>` : ''}
<p class="note">${escapeHtml(ui.disclaimer)}</p>
</body>
</html>`;
};
