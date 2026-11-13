import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculate } from '../src/calculate.ts';
import { params2025 } from '../src/years/2025.ts';

test('2025 main activity, 60 % flat rate, minimum advances paid', () => {
    const result = calculate({
        taxYear: '2025',
        activityType: 'main',
        income: 900_000,
        expenseMode: 'flatRate',
        flatRatePercent: '60',
        socialAdvancesPaid: 12 * 4_759,
        healthAdvancesPaid: 12 * 3_143,
    }, params2025);

    assert.equal(result.tax.expenses, 540_000);
    assert.equal(result.tax.taxBaseRounded, 360_000);
    assert.equal(result.tax.incomeTax, 54_000);
    assert.equal(result.tax.taxBalance, 23_160);

    assert.equal(result.social.socialComputedBase, 198_000);
    assert.equal(result.social.socialBase, 198_000);
    assert.equal(result.social.socialContribution, 57_816);
    assert.equal(result.social.socialBalance, 708);
    assert.equal(result.social.socialNewMonthlyBase, 17_139);
    assert.equal(result.social.socialNewAdvance, 5_005);

    assert.equal(result.health.healthBase, 279_342);
    assert.equal(result.health.healthContribution, 37_712);
    assert.equal(result.health.healthOverpayment, 4);
    assert.equal(result.health.healthNewAdvance, 3_306);
});

test('2025 main activity above the 23 % threshold and flat-rate cap, two children', () => {
    const result = calculate({
        taxYear: '2025',
        activityType: 'main',
        income: 3_000_000,
        expenseMode: 'flatRate',
        flatRatePercent: '60',
        childrenCount: 2,
    }, params2025);

    assert.equal(result.tax.expenses, 1_200_000);
    assert.equal(result.tax.incomeTax, 279_916);
    assert.equal(result.tax.taxAfterCredits, 249_076);
    assert.equal(result.tax.childBenefit, 37_524);
    assert.equal(result.tax.childBonus, 0);
    assert.equal(result.tax.taxBalance, 211_552);

    assert.equal(result.social.socialContribution, 289_080);
    assert.equal(result.social.socialNewAdvance, 24_090);

    assert.equal(result.health.healthContribution, 121_500);
    assert.equal(result.health.healthNewAdvance, 10_125);
});

test('2025 secondary activity below the ČSSZ threshold, one child gets a bonus', () => {
    const result = calculate({
        taxYear: '2025',
        activityType: 'secondary',
        income: 200_000,
        expenseMode: 'flatRate',
        flatRatePercent: '60',
        childrenCount: 1,
    }, params2025);

    assert.equal(result.tax.taxAfterCredits, 0);
    assert.equal(result.tax.childBonus, 15_204);
    assert.equal(result.tax.bonusPayable, 15_204);
    assert.equal(result.tax.taxBalance, -15_204);

    assert.equal(result.social.socialBase, 0);
    assert.equal(result.social.socialContribution, 0);
    assert.equal(result.social.socialNewAdvance, 0);

    assert.equal(result.health.healthBase, 40_000);
    assert.equal(result.health.healthContribution, 5_400);
    assert.equal(result.health.healthNewAdvance, 0);
});

test('2025 secondary activity above the threshold with actual expenses', () => {
    const result = calculate({
        taxYear: '2025',
        activityType: 'secondary',
        income: 400_000,
        expenseMode: 'actual',
        actualExpenses: 150_000,
    }, params2025);

    assert.equal(result.tax.profit, 250_000);
    assert.equal(result.tax.taxBalance, 6_660);

    assert.equal(result.social.socialBase, 137_500);
    assert.equal(result.social.socialContribution, 40_150);
    assert.equal(result.social.socialNewMonthlyBase, 11_459);
    assert.equal(result.social.socialNewAdvance, 3_347);
});

test('every row in the 2025 form schema maps to a calculated value', () => {
    const result = calculate({
        taxYear: '2025', activityType: 'main', income: 500_000, expenseMode: 'flatRate', flatRatePercent: '60',
    }, params2025);
    const values = { dpfo: result.tax, cssz: result.social, vzp: result.health };

    for (const row of params2025.rows) {
        assert.ok(row.key in values[row.form], `${row.form} ${row.row} (${row.key}) has no calculated value`);
    }
});
