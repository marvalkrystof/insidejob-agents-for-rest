import type { Documents } from './documents.ts';
import type { Calculation, FormId, Input, Language, RowDef, YearParams } from './types.ts';

export type ReportRow = {
    form: FormId;
    key: string;
    row: string;
    label: string;
    value: number;
    explanation: string;
    calculation: string;
    sourceUrl: string;
    sourceQuote: string;
};

const FORMS: FormId[] = ['dpfo', 'cssz', 'vzp'];

const FORM_VALUES: Record<FormId, 'tax' | 'social' | 'health'> = { dpfo: 'tax', cssz: 'social', vzp: 'health' };

const OFFICIAL_NAMES: Record<FormId, string> = {
    dpfo: 'Přiznání k dani z příjmů fyzických osob (25 5405) + Příloha č. 1',
    cssz: 'Přehled o příjmech a výdajích OSVČ',
    vzp: 'Přehled o výši daňového základu ze samostatné výdělečné činnosti (Přehled OSVČ)',
};

const KEY_ROWS = new Set(['taxBalance', 'socialBalance', 'socialNewAdvance', 'healthOverpayment', 'healthNewAdvance']);

const EN = {
    title: 'Your OSVČ filings',
    subtitle: 'Every row you need to fill in, explained in plain language, with the official source for each value.',
    summary: 'Summary',
    answerNav: 'AI explanation',
    deadlines: 'Deadlines',
    forms: { dpfo: 'Tax return', cssz: 'ČSSZ přehled', vzp: 'VZP přehled' } as Record<FormId, string>,
    offices: {
        dpfo: 'Income tax · Finanční úřad',
        cssz: 'Social insurance · ČSSZ',
        vzp: 'Health insurance · VZP',
    } as Record<FormId, string>,
    toPay: 'To pay',
    refund: 'Overpaid',
    nothing: 'Nothing to pay',
    dueTax: 'Pay by the tax return filing deadline.',
    dueInsurance: 'Pay within 8 days after you file the přehled.',
    smallRefund: 'Overpayments under 200 Kč are not paid back.',
    newAdvance: 'New monthly advance',
    fromMonthAfter: 'from the month after you file',
    fromMonthOf: 'from the month you file',
    yourQuestion: 'Your question',
    answerNote: 'Written by AI from the rows and calculation in this report. '
        + 'It explains, it never changes the numbers.',
    noQuestion: 'Ask anything in the "Anything you want explained?" field of the input and the AI explanation '
        + 'appears here.',
    answerFailed: 'The AI explanation could not be generated this time. The numbers in this report are not affected, '
        + 'run the Actor again to retry.',
    rowsIntro: 'Copy each value into the row with the same number on the official form.',
    rows: 'rows',
    details: 'How it was calculated · source',
    source: 'Official source',
    identity: 'Personal details (name, rodné číslo, DIČ, address, bank account) are not collected. '
        + 'Fill them in yourself.',
    disclaimer: 'Calculated from the officially published rules for this year, with a source for every row. '
        + 'It is not tax advice: check the values before you submit, and ask a daňový poradce if your situation '
        + 'is outside the supported scope.',
    documents: 'Your documents',
    whereFrom: 'Where your numbers came from',
    income: 'Income',
    csszPaid: 'ČSSZ advances paid',
    vzpPaid: 'VZP advances paid',
    fromYou: 'typed by you',
    fromInvoices: (counted: number, all: number): string => `from ${counted} of ${all} invoices`,
    fromStatement: (count: number): string => `from ${count} payments in your bank statement`,
    notProvided: 'not provided, counted as 0',
    invoices: 'Invoices',
    invoicesNote: 'Amounts from PDFs were read by AI and checked by code (amount without VAT + VAT = total). '
        + 'Fakturoid invoices count by the day they were paid. Check the list against your records.',
    payments: 'Payments to ČSSZ and VZP found in your bank statement',
    paymentsNote: 'Bank statements are read by code only and are never sent to AI.',
    problems: 'Could not be read',
    colFile: 'File',
    colNumber: 'Number',
    colIssued: 'Issued',
    colPaid: 'Paid / due',
    colTotal: 'Total',
    colIncome: 'Counted as income',
    colCheck: 'Check',
    colDate: 'Date',
    colOffice: 'To',
    colAmount: 'Amount',
    notCounted: 'not counted',
};

const UI: Record<Language, typeof EN> = {
    en: EN,
    cs: {
        title: 'Vaše podání OSVČ',
        subtitle: 'Všechny řádky, které potřebujete vyplnit, vysvětlené srozumitelně a se zdrojem u každé hodnoty.',
        summary: 'Shrnutí',
        answerNav: 'Vysvětlení AI',
        deadlines: 'Termíny',
        forms: { dpfo: 'Daňové přiznání', cssz: 'Přehled ČSSZ', vzp: 'Přehled VZP' },
        offices: {
            dpfo: 'Daň z příjmů · Finanční úřad',
            cssz: 'Sociální pojištění · ČSSZ',
            vzp: 'Zdravotní pojištění · VZP',
        },
        toPay: 'Doplatit',
        refund: 'Přeplatek',
        nothing: 'Nic k doplacení',
        dueTax: 'Zaplaťte do termínu pro podání přiznání.',
        dueInsurance: 'Zaplaťte do 8 dnů od podání přehledu.',
        smallRefund: 'Přeplatky pod 200 Kč se nevracejí.',
        newAdvance: 'Nová měsíční záloha',
        fromMonthAfter: 'od měsíce po podání',
        fromMonthOf: 'od měsíce podání',
        yourQuestion: 'Váš dotaz',
        answerNote: 'Napsala AI z řádků a výpočtu v tomto přehledu. Jen vysvětluje, čísla nikdy nemění.',
        noQuestion: 'Napište dotaz do pole „Anything you want explained?“ ve vstupu a vysvětlení AI se objeví tady.',
        answerFailed: 'Vysvětlení AI se tentokrát nepodařilo vytvořit. Čísla v přehledu to neovlivní, '
            + 'pro nový pokus spusťte Actor znovu.',
        rowsIntro: 'Každou hodnotu opište do řádku se stejným číslem na oficiálním formuláři.',
        rows: 'řádků',
        details: 'Jak se to spočítalo · zdroj',
        source: 'Oficiální zdroj',
        identity: 'Osobní údaje (jméno, rodné číslo, DIČ, adresu, číslo účtu) nesbíráme. Doplňte je sami.',
        disclaimer: 'Spočítáno podle oficiálně zveřejněných pravidel pro daný rok, u každého řádku je zdroj. '
            + 'Nejde o daňové poradenství: hodnoty před podáním zkontrolujte a pokud vaše situace přesahuje '
            + 'podporovaný rozsah, obraťte se na daňového poradce.',
        documents: 'Vaše doklady',
        whereFrom: 'Odkud se vzala čísla',
        income: 'Příjmy',
        csszPaid: 'Zaplacené zálohy ČSSZ',
        vzpPaid: 'Zaplacené zálohy VZP',
        fromYou: 'zadali jste ručně',
        fromInvoices: (counted: number, all: number): string => `z ${counted} z ${all} faktur`,
        fromStatement: (count: number): string => `z ${count} plateb ve výpisu z účtu`,
        notProvided: 'nezadáno, počítá se 0',
        invoices: 'Faktury',
        invoicesNote: 'Částky z PDF přečetla AI a kód je zkontroloval (základ + DPH = celkem). Faktury z Fakturoidu '
            + 'se počítají podle data úhrady. Seznam si porovnejte se svou evidencí.',
        payments: 'Platby ČSSZ a VZP nalezené ve výpisu z účtu',
        paymentsNote: 'Výpisy z účtu čte jen kód, nikdy se neposílají AI.',
        problems: 'Nepodařilo se přečíst',
        colFile: 'Soubor',
        colNumber: 'Číslo',
        colIssued: 'Vystaveno',
        colPaid: 'Uhrazeno / splatnost',
        colTotal: 'Celkem',
        colIncome: 'Započteno do příjmů',
        colCheck: 'Zkontrolujte',
        colDate: 'Datum',
        colOffice: 'Komu',
        colAmount: 'Částka',
        notCounted: 'nezapočteno',
    },
};

const escapeHtml = (text: string): string => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const formatKc = (value: number): string => `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč`;

const renderInline = (text: string): string => escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

const renderMarkdown = (markdown: string): string => {
    const html: string[] = [];
    let paragraph: string[] = [];
    let list: 'ul' | 'ol' | null = null;

    const flush = (): void => {
        if (paragraph.length) html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
        paragraph = [];
        if (list) html.push(`</${list}>`);
        list = null;
    };

    for (const line of markdown.split('\n').map((text) => text.trim())) {
        const item = /^(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (item) {
            const type = item[1] ? 'ul' : 'ol';
            if (list !== type) {
                flush();
                html.push(`<${type}>`);
                list = type;
            }
            html.push(`<li>${renderInline(item[2] ?? '')}</li>`);
        } else if (heading) {
            flush();
            html.push(`<h4>${renderInline(heading[1] ?? '')}</h4>`);
        } else if (line) {
            if (list) flush();
            paragraph.push(line);
        } else {
            flush();
        }
    }
    flush();

    return html.join('\n');
};

export const buildRows = (params: YearParams, calculation: Calculation, language: Language): ReportRow[] => {
    const formulas = new Map(calculation.trace.map((step) => [step.key, step.formula]));

    return params.rows.map((def: RowDef) => ({
        form: def.form,
        key: def.key,
        row: def.row,
        label: def.label,
        value: calculation[FORM_VALUES[def.form]][def.key] ?? 0,
        explanation: def.explanation[language],
        calculation: formulas.get(def.key) ?? '',
        sourceUrl: def.source.url,
        sourceQuote: def.source.quote,
    }));
};

const summaryCard = (
    form: FormId,
    balance: number,
    ui: typeof EN,
    extra: { due: string; advance?: number; advanceFrom?: string; note?: string },
): string => {
    const status = balance > 0 ? 'pay' : balance < 0 ? 'refund' : 'none';
    const statusText = { pay: ui.toPay, refund: ui.refund, none: ui.nothing }[status];

    return `
        <a class="card ${status}" href="#${form}">
            <span class="office">${escapeHtml(ui.offices[form])}</span>
            <span class="status">${statusText}</span>
            <span class="amount">${formatKc(Math.abs(balance))}</span>
            ${balance > 0 ? `<span class="hint">${escapeHtml(extra.due)}</span>` : ''}
            ${extra.note ? `<span class="hint">${escapeHtml(extra.note)}</span>` : ''}
            ${extra.advance !== undefined ? `
                <span class="advance">${ui.newAdvance}: <strong>${formatKc(extra.advance)}</strong>
                    <span class="hint">${escapeHtml(extra.advanceFrom ?? '')}</span></span>` : ''}
        </a>`;
};

const documentsSection = (calculation: Calculation, input: Input, documents: Documents, ui: typeof EN): string => {
    const { invoices, payments, errors } = documents;
    const offices = { cssz: 'ČSSZ', vzp: 'VZP' };
    const countedPayments = (office: 'cssz' | 'vzp'): number => payments
        .filter((payment) => payment.office === office && payment.counted).length;
    const paidSource = (typed: number | undefined, found: number | undefined, office: 'cssz' | 'vzp'): string => (
        typed !== undefined
            ? ui.fromYou
            : found !== undefined ? ui.fromStatement(countedPayments(office)) : ui.notProvided
    );
    const flags = (items: string[]): string => items
        .map((flag) => `<span class="flag">${escapeHtml(flag)}</span>`)
        .join('');

    const invoiceTable = invoices.length ? `
        <h3>${ui.invoices}</h3>
        <p class="muted small">${escapeHtml(ui.invoicesNote)}</p>
        <div class="scroll"><table>
            <thead><tr><th>${ui.colFile}</th><th>${ui.colNumber}</th><th>${ui.colIssued}</th><th>${ui.colPaid}</th>
                <th class="num">${ui.colTotal}</th><th class="num">${ui.colIncome}</th>
                <th>${ui.colCheck}</th></tr></thead>
            <tbody>${invoices.map((invoice) => `
                <tr class="${invoice.counted ? '' : 'off'}">
                    <td>${escapeHtml(invoice.source)}</td><td>${escapeHtml(invoice.number)}</td>
                    <td>${escapeHtml(invoice.issuedOn)}</td>
                    <td>${escapeHtml(invoice.paidOn ?? invoice.dueOn ?? '')}</td>
                    <td class="num">${formatKc(invoice.total)}</td>
                    <td class="num">${invoice.counted ? formatKc(invoice.income) : ui.notCounted}</td>
                    <td>${flags(invoice.flags)}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>` : '';

    const paymentTable = payments.length ? `
        <h3>${ui.payments}</h3>
        <p class="muted small">${escapeHtml(ui.paymentsNote)}</p>
        <div class="scroll"><table>
            <thead><tr><th>${ui.colDate}</th><th>${ui.colOffice}</th><th class="num">${ui.colAmount}</th>
                <th>${ui.colFile}</th><th>${ui.colCheck}</th></tr></thead>
            <tbody>${payments.map((payment) => `
                <tr class="${payment.counted ? '' : 'off'}">
                    <td>${escapeHtml(payment.date ?? '?')}</td><td>${offices[payment.office]}</td>
                    <td class="num">${payment.counted ? formatKc(payment.amount) : ui.notCounted}</td>
                    <td>${escapeHtml(payment.source)}</td><td>${flags(payment.flags)}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>` : '';

    return `
    <section id="documents">
        <h2>${ui.documents}</h2>
        <div class="panel">
            <h3>${ui.whereFrom}</h3>
            <ul class="sources">
                <li><span>${ui.income}</span><strong>${formatKc(calculation.tax.income ?? 0)}</strong>
                    <span class="muted">${input.income !== undefined ? ui.fromYou
                        : ui.fromInvoices(invoices.filter((i) => i.counted).length, invoices.length)}</span></li>
                <li><span>${ui.csszPaid}</span><strong>${formatKc(calculation.social.socialAdvancesPaid ?? 0)}</strong>
                    <span class="muted">${paidSource(input.socialAdvancesPaid, documents.socialPaid, 'cssz')}
                    </span></li>
                <li><span>${ui.vzpPaid}</span><strong>${formatKc(calculation.health.healthAdvancesPaid ?? 0)}</strong>
                    <span class="muted">${paidSource(input.healthAdvancesPaid, documents.healthPaid, 'vzp')}</span></li>
            </ul>
            ${errors.length ? `<h3>${ui.problems}</h3><ul>${errors
                .map((error) => `<li class="flag-text">${escapeHtml(error)}</li>`)
                .join('')}</ul>` : ''}
            ${invoiceTable}
            ${paymentTable}
        </div>
    </section>`;
};

const rowHtml = (row: ReportRow, ui: typeof EN): string => `
    <article class="row${KEY_ROWS.has(row.key) ? ' key' : ''}">
        <div class="row-head">
            <span class="badge">${escapeHtml(row.row)}</span>
            <span class="label">${escapeHtml(row.label)}</span>
            <span class="value">${formatKc(row.value)}</span>
        </div>
        <p class="explain">${escapeHtml(row.explanation)}</p>
        <details>
            <summary>${ui.details}</summary>
            <p><code>${escapeHtml(row.calculation)}</code></p>
            <blockquote>${escapeHtml(row.sourceQuote)}</blockquote>
            <a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener">${ui.source} ↗</a>
        </details>
    </article>`;

export const buildHtml = (
    params: YearParams,
    calculation: Calculation,
    rows: ReportRow[],
    language: Language,
    input: Input,
    documents: Documents,
    answer: string | null,
): string => {
    const ui = UI[language];
    const { notes } = input;
    const hasDocuments = Boolean(input.invoiceFiles?.length || input.bankStatementFiles?.length
        || input.fakturoidClientId || documents.errors.length);
    const { tax, social, health } = calculation;
    const healthBalance = health.healthBalance ?? 0;

    const answerBody = !notes?.trim()
        ? `<p class="muted">${escapeHtml(ui.noQuestion)}</p>`
        : `<p class="question"><span>${ui.yourQuestion}:</span> ${escapeHtml(notes)}</p>
           ${answer ? `<div class="markdown">${renderMarkdown(answer)}</div>
           <p class="muted small">${escapeHtml(ui.answerNote)}</p>`
        : `<p class="muted">${escapeHtml(ui.answerFailed)}</p>`}`;

    const formSections = FORMS.map((form) => {
        const formRows = rows.filter((row) => row.form === form);
        return `
        <section id="${form}">
            <h2>${escapeHtml(ui.forms[form])}</h2>
            <p class="official">${escapeHtml(OFFICIAL_NAMES[form])} · ${formRows.length} ${ui.rows}</p>
            <p class="muted">${escapeHtml(ui.rowsIntro)}</p>
            ${formRows.map((row) => rowHtml(row, ui)).join('')}
        </section>`;
    }).join('');

    const deadlines = params.deadlines.map((deadline) => `
        <li>
            <span class="date">${escapeHtml(deadline.date)}</span>
            <span><strong>${escapeHtml(ui.forms[deadline.form])}:</strong> ${escapeHtml(deadline.what[language])}
                <a href="${escapeHtml(deadline.source.url)}" target="_blank" rel="noopener">${ui.source} ↗</a></span>
        </li>`).join('');

    return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ui.title} ${params.year}</title>
<style>
    :root {
        --bg: #f6f7f9; --surface: #ffffff; --text: #1b1f24; --muted: #5d6570; --border: #e2e5ea;
        --accent: #2457d6; --pay: #b54708; --pay-bg: #fff4e5; --refund: #067647; --refund-bg: #e8f7ee;
        --none-bg: #f0f2f5; --key-bg: #f3f6ff;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --bg: #111418; --surface: #1a1e24; --text: #e8eaed; --muted: #9aa3ad; --border: #2c323a;
            --accent: #7aa2ff; --pay: #ffb366; --pay-bg: #33261a; --refund: #5fd394; --refund-bg: #17301f;
            --none-bg: #22272e; --key-bg: #1c2333;
        }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, sans-serif; }
    a { color: var(--accent); }
    header { padding: 28px 16px 8px; max-width: 960px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    nav { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); }
    nav div { max-width: 960px; margin: 0 auto; padding: 8px 16px; display: flex; gap: 6px; overflow-x: auto; }
    nav a { white-space: nowrap; padding: 6px 12px; border-radius: 999px; text-decoration: none; color: var(--text);
        background: var(--surface); border: 1px solid var(--border); font-size: 14px; }
    nav a:hover { border-color: var(--accent); color: var(--accent); }
    main { max-width: 960px; margin: 0 auto; padding: 8px 16px 48px; }
    section { scroll-margin-top: 60px; margin-top: 28px; }
    h2 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: var(--muted); }
    .small { font-size: 13px; }
    .official { color: var(--muted); font-size: 13px; margin: 0 0 4px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 12px; text-decoration: none;
        color: var(--text); background: var(--surface); border: 1px solid var(--border); }
    .card .office { font-size: 13px; color: var(--muted); }
    .card .status { font-weight: 600; }
    .card .amount { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .card.pay .status, .card.pay .amount { color: var(--pay); }
    .card.pay { background: var(--pay-bg); }
    .card.refund .status, .card.refund .amount { color: var(--refund); }
    .card.refund { background: var(--refund-bg); }
    .card.none { background: var(--none-bg); }
    .hint { font-size: 13px; color: var(--muted); }
    .advance { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 14px; }
    .advance .hint { display: block; }
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; }
    .ai { border-left: 4px solid var(--accent); }
    .ai .question span { font-weight: 600; }
    .markdown h4 { margin: 14px 0 4px; }
    .markdown ul, .markdown ol { padding-left: 22px; }
    .row { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px;
        margin-top: 8px; }
    .row.key { background: var(--key-bg); border-color: var(--accent); }
    .row-head { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: baseline; }
    .badge { font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 6px; background: var(--none-bg);
        white-space: nowrap; }
    .label { font-size: 13px; color: var(--muted); }
    .value { font-weight: 700; font-size: 17px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .explain { margin: 6px 0 0; }
    details { margin-top: 6px; font-size: 13px; }
    summary { cursor: pointer; color: var(--accent); }
    blockquote { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--border); color: var(--muted); }
    code { font-size: 12px; background: var(--none-bg); padding: 1px 4px; border-radius: 4px; }
    .timeline { list-style: none; padding: 0; margin: 0; }
    .timeline li { display: grid; grid-template-columns: 210px 1fr; gap: 12px; padding: 12px 0;
        border-bottom: 1px solid var(--border); }
    .date { font-weight: 700; }
    footer { margin-top: 32px; font-size: 13px; color: var(--muted); }
    h3 { font-size: 16px; margin: 18px 0 4px; }
    .sources { list-style: none; padding: 0; margin: 0; }
    .sources li { display: grid; grid-template-columns: 200px 140px 1fr; gap: 12px; padding: 6px 0;
        border-bottom: 1px solid var(--border); }
    .sources strong { text-align: right; font-variant-numeric: tabular-nums; }
    .scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    tr.off td { color: var(--muted); }
    .flag { display: block; color: var(--pay); }
    .flag-text { color: var(--pay); }
    @media (max-width: 640px) {
        .row-head { grid-template-columns: auto 1fr; }
        .value { grid-column: 1 / -1; }
        .timeline li { grid-template-columns: 1fr; gap: 2px; }
        .sources li { grid-template-columns: 1fr auto; }
        .sources .muted { grid-column: 1 / -1; }
    }
</style>
</head>
<body>
<header>
    <h1>${ui.title} ${params.year}</h1>
    <p class="muted">${escapeHtml(ui.subtitle)}</p>
</header>
<nav><div>
    <a href="#summary">${ui.summary}</a>
    <a href="#answer">${ui.answerNav}</a>
    ${hasDocuments ? `<a href="#documents">${ui.documents}</a>` : ''}
    ${FORMS.map((form) => `<a href="#${form}">${escapeHtml(ui.forms[form])}</a>`).join('')}
    <a href="#deadlines">${ui.deadlines}</a>
</div></nav>
<main>
    <section id="summary">
        <h2>${ui.summary}</h2>
        <div class="cards">
            ${summaryCard('dpfo', tax.taxBalance ?? 0, ui, { due: ui.dueTax })}
            ${summaryCard('cssz', social.socialBalance ?? 0, ui, {
                due: ui.dueInsurance,
                advance: social.socialNewAdvance ?? 0,
                advanceFrom: ui.fromMonthAfter,
            })}
            ${summaryCard('vzp', healthBalance, ui, {
                due: ui.dueInsurance,
                advance: health.healthNewAdvance ?? 0,
                advanceFrom: ui.fromMonthOf,
                note: healthBalance < 0 && healthBalance > -200 ? ui.smallRefund : undefined,
            })}
        </div>
        <p class="muted small">${escapeHtml(ui.identity)}</p>
    </section>
    <section id="answer">
        <h2>${ui.answerNav}</h2>
        <div class="panel ai">${answerBody}</div>
    </section>
    ${hasDocuments ? documentsSection(calculation, input, documents, ui) : ''}
    ${formSections}
    <section id="deadlines">
        <h2>${ui.deadlines}</h2>
        <div class="panel"><ul class="timeline">${deadlines}</ul></div>
    </section>
    <footer>${escapeHtml(ui.disclaimer)}</footer>
</main>
</body>
</html>`;
};
