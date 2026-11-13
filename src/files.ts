import { Actor } from 'apify';
import { extractText, getDocumentProxy } from 'unpdf';

export type LoadedFile = {
    name: string;
    text: string;
    isPdf: boolean;
};

const PDF_MAGIC = '%PDF';
const MAX_PDF_PAGES = 50;

const readBytes = async (ref: string): Promise<Uint8Array> => {
    if (/^https?:\/\//.test(ref)) {
        const isApify = new URL(ref).hostname === 'api.apify.com';
        const response = await fetch(ref, {
            headers: isApify && process.env.APIFY_TOKEN ? { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } : {},
        });
        if (!response.ok) throw new Error(`Could not download ${ref} (HTTP ${response.status}).`);
        return new Uint8Array(await response.arrayBuffer());
    }

    const value = await Actor.getValue<Buffer | string>(ref);
    if (value === null) throw new Error(`Uploaded file "${ref}" was not found.`);
    return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
};

const decodeText = (bytes: Uint8Array): string => {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    return utf8.includes('�') ? new TextDecoder('windows-1250').decode(bytes) : utf8;
};

/** Downloads an uploaded file (URL or key-value store key) and returns its text. PDFs are read with unpdf. */
export const loadFile = async (ref: string): Promise<LoadedFile> => {
    const bytes = await readBytes(ref);
    const name = decodeURIComponent(ref.split('?')[0]?.split('/').pop() ?? ref);
    const isPdf = new TextDecoder().decode(bytes.slice(0, 4)) === PDF_MAGIC;
    if (!isPdf) return { name, text: decodeText(bytes), isPdf };

    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > MAX_PDF_PAGES) {
        throw new Error(`${name} has ${pdf.numPages} pages, the limit is ${MAX_PDF_PAGES}.`);
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return { name, text: text.trim(), isPdf };
};
