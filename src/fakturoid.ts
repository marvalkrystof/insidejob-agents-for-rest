import { log } from 'apify';

import type { Invoice } from './invoices.ts';

const API = 'https://app.fakturoid.cz/api/v3';
const USER_AGENT = 'OSVC Forms Helper (marek.macku@seznam.cz)';
const PAGE_SIZE = 40;
const INCOME_TYPES = new Set(['invoice', 'final_invoice', 'correction']);

type FakturoidInvoice = {
    number: string;
    document_type: string;
    status: string;
    issued_on: string;
    due_on?: string | null;
    paid_on?: string | null;
    native_subtotal: string | number;
    native_total: string | number;
    paid_advances?: unknown[];
};

const request = async <T>(url: string, init: RequestInit): Promise<T> => {
    const response = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', ...init.headers },
    });
    if (!response.ok) throw new Error(`Fakturoid ${url} failed (HTTP ${response.status}): ${await response.text()}`);
    return (await response.json()) as T;
};

/** Converts one Fakturoid document into an income line. Income counts when it was paid (paid_on). */
export const toFakturoidInvoice = (doc: FakturoidInvoice, year: number): Invoice => {
    const subtotal = Number(doc.native_subtotal);
    const total = Number(doc.native_total);
    const paidInYear = doc.paid_on?.startsWith(`${year}-`) ?? false;
    const flags: string[] = [];

    if (!doc.paid_on) flags.push(`Not paid (status: ${doc.status}), not counted.`);
    else if (!paidInYear) flags.push(`Paid on ${doc.paid_on}, outside ${year}.`);
    if (doc.paid_advances?.length) flags.push('Includes advance payments: check in which year they were paid.');

    return {
        source: 'Fakturoid',
        number: doc.number,
        issuedOn: doc.issued_on,
        dueOn: doc.due_on ?? undefined,
        paidOn: doc.paid_on ?? undefined,
        currency: 'CZK',
        subtotal,
        vat: Math.round((total - subtotal) * 100) / 100,
        total,
        income: subtotal,
        counted: paidInYear,
        flags,
    };
};

/** Reads the issued invoices of the connected Fakturoid account (Client Credentials flow, read-only). */
export const fetchFakturoidInvoices = async (
    clientId: string,
    clientSecret: string,
    year: number,
): Promise<Invoice[]> => {
    const { access_token: token } = await request<{ access_token: string }>(`${API}/oauth/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
    });
    const auth = { Authorization: `Bearer ${token}` };

    const { accounts } = await request<{ accounts: { slug: string }[] }>(`${API}/user.json`, { headers: auth });
    const slug = accounts[0]?.slug;
    if (!slug) throw new Error('This Fakturoid user has no account.');
    if (accounts.length > 1) log.warning(`Fakturoid user has ${accounts.length} accounts, using "${slug}".`);

    const docs: FakturoidInvoice[] = [];
    for (let page = 1; ; page++) {
        const url = `${API}/accounts/${slug}/invoices.json?document_type=regular&since=${year - 1}-01-01T00:00:00Z`
            + `&page=${page}`;
        const batch = await request<FakturoidInvoice[]>(url, { headers: auth });
        docs.push(...batch);
        if (batch.length < PAGE_SIZE) break;
    }
    log.info(`Fakturoid: read ${docs.length} documents from account "${slug}".`);

    return docs
        .filter((doc) => INCOME_TYPES.has(doc.document_type))
        .filter((doc) => doc.paid_on?.startsWith(`${year}-`) || doc.issued_on.startsWith(`${year}-`))
        .map((doc) => toFakturoidInvoice(doc, year));
};
