import { log } from 'apify';

import { type AdvancePayment, findAdvancePayments } from './bank-statement.ts';
import { fetchFakturoidInvoices } from './fakturoid.ts';
import { type LoadedFile, loadFile } from './files.ts';
import { extractPdfInvoices, type Invoice } from './invoices.ts';
import type { Input } from './types.ts';

export type Documents = {
    invoices: Invoice[];
    payments: AdvancePayment[];
    errors: string[];
    /** Undefined when no invoice could be read (none uploaded, or all failed). */
    invoiceIncome?: number;
    /** Undefined when no bank statement could be read. */
    socialPaid?: number;
    healthPaid?: number;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reads invoices (PDFs, Fakturoid) and bank statements, and sums what they say about income and paid advances. */
export const collectDocuments = async (input: Input, year: number): Promise<Documents> => {
    const errors: string[] = [];
    const load = async (refs: string[] = []): Promise<LoadedFile[]> => {
        const files = await Promise.all(refs.map(async (ref) => loadFile(ref).catch((error: unknown) => {
            errors.push(errorMessage(error));
            return null;
        })));
        return files.filter((file): file is LoadedFile => file !== null);
    };

    const invoices: Invoice[] = [];
    if (input.fakturoidClientId && input.fakturoidClientSecret) {
        await fetchFakturoidInvoices(input.fakturoidClientId, input.fakturoidClientSecret, year)
            .then((items) => invoices.push(...items))
            .catch((error: unknown) => errors.push(`Fakturoid: ${errorMessage(error)}`));
    }
    invoices.push(...await extractPdfInvoices(await load(input.invoiceFiles), year));

    const statements = await load(input.bankStatementFiles);
    const payments = statements.flatMap((file) => findAdvancePayments(file, year));
    const sumPayments = (office: AdvancePayment['office']): number => payments
        .filter((payment) => payment.office === office && payment.counted)
        .reduce((sum, payment) => sum + payment.amount, 0);

    for (const error of errors) log.warning(error);

    return {
        invoices,
        payments,
        errors,
        invoiceIncome: invoices.length
            ? Math.round(invoices.filter((invoice) => invoice.counted).reduce((sum, i) => sum + i.income, 0))
            : undefined,
        socialPaid: statements.length ? Math.round(sumPayments('cssz')) : undefined,
        healthPaid: statements.length ? Math.round(sumPayments('vzp')) : undefined,
    };
};
