import { log } from 'apify';

import { chatCompletion } from './featherless.ts';
import type { LoadedFile } from './files.ts';

export type Invoice = {
    source: string;
    number: string;
    issuedOn: string;
    dueOn?: string;
    paidOn?: string;
    currency: string;
    subtotal: number;
    vat: number;
    total: number;
    income: number;
    counted: boolean;
    flags: string[];
};

export type ExtractedInvoice = {
    file: number;
    number?: string | null;
    issuedOn?: string | null;
    dueOn?: string | null;
    currency?: string | null;
    subtotal?: number | null;
    vat?: number | null;
    total?: number | null;
};

const BATCH_SIZE = 10;

const PROMPT = [
    'You extract data from Czech invoices (faktury) that a freelancer ISSUED to customers.',
    'For each <invoice file="N"> return one object. Reply with ONLY a JSON array, no other text:',
    '[{"file": N, "number": "invoice number", "issuedOn": "YYYY-MM-DD (datum vystavení)",',
    '"dueOn": "YYYY-MM-DD (datum splatnosti) or null", "currency": "CZK", "subtotal": amount without VAT,',
    '"vat": VAT amount (0 if no VAT), "total": total amount to pay (celkem k úhradě)}]',
    'Amounts are plain numbers with a dot as decimal separator. Use null for anything not on the invoice.',
    'Never guess or calculate a value that is not printed on the invoice.',
].join('\n');

/** Turns one extracted invoice into an income line and flags anything that needs a manual check. */
export const toInvoice = (raw: ExtractedInvoice, source: string, year: number): Invoice => {
    const flags: string[] = [];
    const total = raw.total ?? 0;
    const vat = raw.vat ?? 0;
    const subtotal = raw.subtotal ?? (vat === 0 ? total : 0);
    const currency = (raw.currency ?? 'CZK').toUpperCase();
    const issuedOn = raw.issuedOn ?? '';

    if (!raw.total) flags.push('Total not found on the invoice.');
    if (Math.abs(subtotal + vat - total) > 1) flags.push('Amount without VAT + VAT does not equal the total.');
    if (currency !== 'CZK') flags.push(`In ${currency}: convert to CZK and add it yourself.`);
    if (!issuedOn.startsWith(`${year}-`)) flags.push(`Not issued in ${year}.`);
    if (raw.dueOn && !raw.dueOn.startsWith(`${year}-`) && raw.dueOn > issuedOn) {
        flags.push(`Due in ${raw.dueOn.slice(0, 4)}: count it only if it was paid in ${year}.`);
    }

    const counted = flags.every((flag) => flag.startsWith('Due in'));

    return {
        source,
        number: raw.number ?? '?',
        issuedOn,
        dueOn: raw.dueOn ?? undefined,
        currency,
        subtotal,
        vat,
        total,
        income: vat > 0 ? subtotal : total,
        counted,
        flags,
    };
};

const parseJsonArray = (text: string): ExtractedInvoice[] => {
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? (parsed as ExtractedInvoice[]) : [];
    } catch {
        return [];
    }
};

/** Reads issued invoices from uploaded PDFs: the AI extracts the printed values, code checks and sums them. */
export const extractPdfInvoices = async (files: LoadedFile[], year: number): Promise<Invoice[]> => {
    const invoices: Invoice[] = [];
    const unreadable = (file: LoadedFile, reason: string): Invoice => ({
        ...toInvoice({ file: 0 }, file.name, year),
        flags: [reason],
        counted: false,
    });

    const readable = files.filter((file) => {
        if (file.text) return true;
        invoices.push(unreadable(file, 'No text in this PDF (scanned image?). Add it to your income yourself.'));
        return false;
    });

    for (let start = 0; start < readable.length; start += BATCH_SIZE) {
        const batch = readable.slice(start, start + BATCH_SIZE);
        log.info(`Reading invoices ${start + 1}–${start + batch.length} of ${readable.length} with AI...`);
        const answer = await chatCompletion([
            { role: 'system', content: PROMPT },
            {
                role: 'user',
                content: batch.map((file, i) => `<invoice file="${i}">\n${file.text}\n</invoice>`).join('\n'),
            },
        ], 8192);
        const extracted = parseJsonArray(answer ?? '');

        batch.forEach((file, i) => {
            const raw = extracted.find((item) => item.file === i);
            invoices.push(raw
                ? toInvoice(raw, file.name, year)
                : unreadable(file, 'The AI could not read this invoice.'));
        });
    }

    return invoices;
};
