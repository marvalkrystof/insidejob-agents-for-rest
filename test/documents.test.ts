import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findAdvancePayments } from '../src/bank-statement.ts';
import { toFakturoidInvoice } from '../src/fakturoid.ts';
import { toInvoice } from '../src/invoices.ts';

const FIO_CSV = [
    '"ID pohybu";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"VS";"Zpráva pro příjemce"',
    '"1";"20.12.2024";"-4759,00";"CZK";"01011-7921101";"PSSZ";"0710";"12345678";"Záloha DP"',
    '"2";"20.01.2025";"-4759,00";"CZK";"01011-7921101";"PSSZ";"0710";"12345678";"Záloha DP"',
    '"3";"20.01.2025";"-3143,00";"CZK";"1112223334";"VZP ČR";"0710";"8001011234";"Pojistné"',
    '"4";"21.01.2025";"-180,00";"CZK";"11017-7921101";"PSSZ";"0710";"8001011234";"Nemocenské"',
    '"5";"05.02.2025";"25000,00";"CZK";"123456789";"Zákazník s.r.o.";"0800";"2025001";"Faktura"',
    '"6";"20.02.2025";"-4759,00";"CZK";"01011-7921101";"PSSZ";"0710";"12345678";"Záloha DP"',
].join('\n');

test('bank statement CSV: finds ČSSZ and VZP advances, skips sickness insurance and income', () => {
    const payments = findAdvancePayments({ name: 'fio.csv', text: FIO_CSV, isPdf: false }, 2025);

    assert.deepEqual(payments.map((p) => [p.office, p.date, p.amount, p.counted]), [
        ['cssz', '2024-12-20', 4759, false],
        ['cssz', '2025-01-20', 4759, true],
        ['vzp', '2025-01-20', 3143, true],
        ['cssz', '2025-02-20', 4759, true],
    ]);
    assert.match(payments[1]?.flags[0] ?? '', /January payment/);
});

test('bank statement PDF text: Czech number formats and a Unicode minus', () => {
    const text = [
        '15. 03. 2025  Platba OSSZ Praha 01011-7921101/0710  −4 759,00 CZK',
        '15.03.2025 Všeobecná zdravotní pojišťovna 1112223334/0710 -3 143,00',
        '16.03.2025 Nákup potravin -1 250,00',
    ].join('\n');

    const payments = findAdvancePayments({ name: 'vypis.pdf', text, isPdf: true }, 2025);

    assert.deepEqual(payments.map((p) => [p.office, p.date, p.amount]), [
        ['cssz', '2025-03-15', 4759],
        ['vzp', '2025-03-15', 3143],
    ]);
});

test('PDF invoice: VAT payer counts the amount without VAT', () => {
    const invoice = toInvoice({
        file: 0, number: '2025001', issuedOn: '2025-03-01', dueOn: '2025-03-15', currency: 'CZK',
        subtotal: 10_000, vat: 2_100, total: 12_100,
    }, 'f1.pdf', 2025);

    assert.equal(invoice.income, 10_000);
    assert.equal(invoice.counted, true);
    assert.deepEqual(invoice.flags, []);
});

test('PDF invoice: non-VAT payer counts the total', () => {
    const invoice = toInvoice({ file: 0, issuedOn: '2025-05-10', subtotal: null, vat: 0, total: 25_000 }, 'f2', 2025);

    assert.equal(invoice.income, 25_000);
    assert.equal(invoice.counted, true);
});

test('PDF invoice: inconsistent amounts, other year or foreign currency are not counted', () => {
    const mismatch = toInvoice({ file: 0, issuedOn: '2025-01-01', subtotal: 10_000, vat: 2_100, total: 13_000 }, 'a',
        2025);
    const lastYear = toInvoice({ file: 0, issuedOn: '2024-12-30', vat: 0, total: 5_000 }, 'b', 2025);
    const euro = toInvoice({ file: 0, issuedOn: '2025-04-01', currency: 'EUR', vat: 0, total: 1_000 }, 'c', 2025);

    assert.deepEqual([mismatch.counted, lastYear.counted, euro.counted], [false, false, false]);
});

test('PDF invoice: due next year is counted but flagged', () => {
    const invoice = toInvoice({ file: 0, issuedOn: '2025-12-20', dueOn: '2026-01-05', vat: 0, total: 8_000 }, 'd',
        2025);

    assert.equal(invoice.counted, true);
    assert.match(invoice.flags[0] ?? '', /Due in 2026/);
});

test('Fakturoid: counts invoices by the day they were paid', () => {
    const base = { number: '2025-0001', document_type: 'invoice', issued_on: '2025-12-15', native_subtotal: '10000.0' };
    const paid = toFakturoidInvoice({ ...base, status: 'paid', paid_on: '2025-12-20', native_total: '12100.0' }, 2025);
    const paidLate = toFakturoidInvoice({ ...base, status: 'paid', paid_on: '2026-01-05', native_total: '12100.0' },
        2025);
    const unpaid = toFakturoidInvoice({ ...base, status: 'overdue', paid_on: null, native_total: '12100.0' }, 2025);

    assert.deepEqual([paid.counted, paid.income, paid.vat], [true, 10_000, 2_100]);
    assert.equal(paidLate.counted, false);
    assert.equal(unpaid.counted, false);
});
