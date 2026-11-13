import type { Calculation, FlatRatePercent, Input, TraceStep, YearParams } from './types.ts';

const ceilKc = (value: number): number => Math.ceil(Math.round(value * 100) / 100);

const floorHundreds = (value: number): number => Math.floor(value / 100) * 100;

export const calculate = (input: Input, params: YearParams): Calculation => {
    const trace: TraceStep[] = [];
    const step = (key: string, value: number, formula: string): number => {
        trace.push({ key, value, formula });
        return value;
    };

    const { tax, social, health } = params;
    const percent = Number(input.flatRatePercent ?? 60) as FlatRatePercent;

    // Shared: příjmy, výdaje, zisk (Příloha 1, oddíl A)
    const income = step('income', input.income, 'your §7 income (příjmy)');
    const expenses = input.expenseMode === 'flatRate'
        ? step(
            'expenses',
            Math.min(Math.round(income * percent / 100), tax.flatRateCaps.value[percent]),
            `min(${percent} % × income, cap ${tax.flatRateCaps.value[percent]})`,
        )
        : step('expenses', input.actualExpenses ?? 0, 'your actual expenses (skutečné výdaje)');
    const profit = step('profit', income - expenses, 'income − expenses');

    // DPFO
    const taxBase = step('taxBase', Math.max(0, profit), 'dílčí základ daně §7 (a loss counts as 0 here)');
    const taxBaseRounded = step('taxBaseRounded', floorHundreds(taxBase), 'taxBase rounded down to whole hundreds');
    const threshold = tax.highRateThreshold.value;
    const incomeTax = step(
        'incomeTax',
        ceilKc(
            Math.min(taxBaseRounded, threshold) * tax.rateBase.value
            + Math.max(0, taxBaseRounded - threshold) * tax.rateHigh.value,
        ),
        `${tax.rateBase.value * 100} % up to ${threshold} + ${tax.rateHigh.value * 100} % above, rounded up`,
    );
    const taxpayerCredit = step('taxpayerCredit', tax.taxpayerCredit.value, 'sleva na poplatníka (fixed per year)');
    const taxAfterCredits = step(
        'taxAfterCredits',
        Math.max(0, incomeTax - taxpayerCredit),
        'incomeTax − taxpayerCredit, never below 0',
    );

    const children = input.childrenCount ?? 0;
    const [first, second, third] = tax.childBenefit.value;
    const childBenefit = step(
        'childBenefit',
        Array.from({ length: children }, (_, i) => (i === 0 ? first : i === 1 ? second : third))
            .reduce((sum, value) => sum + value, 0),
        `${children} child(ren): 1st ${first}, 2nd ${second}, 3rd+ ${third}`,
    );
    const childDiscount = step(
        'childDiscount',
        Math.min(taxAfterCredits, childBenefit),
        'min(taxAfterCredits, childBenefit)',
    );
    const taxAfterChild = step('taxAfterChild', taxAfterCredits - childDiscount, 'taxAfterCredits − childDiscount');
    const bonusCandidate = childBenefit - childDiscount;
    const childBonus = step(
        'childBonus',
        income >= tax.childBonusMinIncome.value && bonusCandidate >= tax.childBonusMinAmount.value ? bonusCandidate : 0,
        `childBenefit − childDiscount, paid only if income ≥ ${tax.childBonusMinIncome.value} `
            + `and bonus ≥ ${tax.childBonusMinAmount.value}`,
    );
    const taxAfterBonus = step(
        'taxAfterBonus',
        Math.max(0, taxAfterChild - childBonus),
        'ř. 75 − ř. 76, never below 0',
    );
    const bonusPayable = step('bonusPayable', Math.max(0, childBonus - taxAfterChild), 'ř. 76 − ř. 75, never below 0');
    const taxAdvancesPaid = step('taxAdvancesPaid', input.taxAdvancesPaid ?? 0, 'tax advances you already paid');
    const taxBalance = step(
        'taxBalance',
        taxAfterBonus - bonusPayable - taxAdvancesPaid,
        'ř. 77 − ř. 77a − ř. 85 (+ = to pay, − = refund)',
    );

    // ČSSZ přehled
    const isMain = input.activityType === 'main';
    const socialParticipates = isMain || taxBase >= social.secondaryThreshold.value;
    step(
        'socialParticipates',
        socialParticipates ? 1 : 0,
        isMain ? 'main activity always pays' : `secondary pays only if profit ≥ ${social.secondaryThreshold.value}`,
    );
    const socialMonths = step('socialMonths', 12, 'full year of activity');
    const socialAvgMonthly = step(
        'socialAvgMonthly',
        Math.round(taxBase / socialMonths * 100) / 100,
        'daňový základ / 12 months',
    );
    const socialComputedBase = step(
        'socialComputedBase',
        socialParticipates ? ceilKc(taxBase * social.assessmentShare.value) : 0,
        socialParticipates
            ? `${social.assessmentShare.value * 100} % of profit, rounded up`
            : 'secondary activity below the threshold: 0',
    );
    const socialMinBase = socialParticipates ? social.minMonthlyBase.value[input.activityType] * socialMonths : 0;
    const socialFloorBase = step(
        'socialFloorBase',
        Math.max(socialComputedBase, socialMinBase),
        `max(computed, minimum ${social.minMonthlyBase.value[input.activityType]} × 12 = ${socialMinBase})`,
    );
    const socialBase = step(
        'socialBase',
        Math.min(socialFloorBase, social.maxYearlyBase.value),
        `ř. 27 capped at the maximum ${social.maxYearlyBase.value}`,
    );
    const socialContribution = step(
        'socialContribution',
        ceilKc(socialBase * social.rate.value),
        `${social.rate.value * 100} % × socialBase, rounded up`,
    );
    const socialAdvancesPaid = step('socialAdvancesPaid', input.socialAdvancesPaid ?? 0, 'social advances you paid');
    const socialBalance = step(
        'socialBalance',
        socialContribution - socialAdvancesPaid,
        'socialContribution − socialAdvancesPaid (+ = doplatek, − = přeplatek)',
    );
    const nextMin = social.nextYearMinMonthlyBase.value[input.activityType];
    const socialNewMonthlyBase = step(
        'socialNewMonthlyBase',
        socialParticipates
            ? Math.min(
                Math.max(ceilKc(taxBase * social.assessmentShare.value / socialMonths), nextMin),
                social.nextYearMaxMonthlyBase.value,
            )
            : 0,
        socialParticipates
            ? `max(${social.assessmentShare.value} × profit / 12 rounded up, next year's minimum ${nextMin})`
            : 'secondary activity below the threshold: no advances',
    );
    const socialNewAdvance = step(
        'socialNewAdvance',
        ceilKc(socialNewMonthlyBase * social.rate.value),
        `${social.rate.value * 100} % × new monthly base, rounded up`,
    );

    // VZP přehled
    const healthComputedBase = step(
        'healthComputedBase',
        Math.max(0, profit) * health.assessmentShare.value,
        `${health.assessmentShare.value * 100} % of profit (kept in haléře, no rounding)`,
    );
    const healthMonths = step('healthMonths', 12, 'full year of activity, insured at VZP all year');
    const healthMinMonths = step(
        'healthMinMonths',
        isMain ? 12 : 0,
        isMain ? 'minimum base applied every month' : 'secondary activity assumed exempt from the minimum all year',
    );
    const healthMinBase = step(
        'healthMinBase',
        health.minMonthlyBase.value * healthMinMonths,
        `minimum monthly base ${health.minMonthlyBase.value} × ${healthMinMonths} months`,
    );
    const healthBase = step('healthBase', Math.max(healthComputedBase, healthMinBase), 'max(computed, minimum)');
    const healthContribution = step(
        'healthContribution',
        ceilKc(healthBase * health.rate.value),
        `${health.rate.value * 100} % × healthBase, rounded up`,
    );
    const healthAdvancesPaid = step('healthAdvancesPaid', input.healthAdvancesPaid ?? 0, 'health advances you paid');
    const healthOverpayment = step(
        'healthOverpayment',
        healthAdvancesPaid - healthContribution,
        'healthAdvancesPaid − healthContribution (+ = přeplatek, − = doplatek), as the form asks',
    );
    const healthBalance = -healthOverpayment;
    const healthNewAdvance = step(
        'healthNewAdvance',
        isMain
            ? Math.max(
                ceilKc(health.rate.value * health.assessmentShare.value * Math.max(0, profit) / healthMonths),
                health.nextYearMinAdvance.value,
            )
            : 0,
        isMain
            ? `max(${health.rate.value} × ${health.assessmentShare.value} × profit / 12 rounded up, `
                + `next year's minimum ${health.nextYearMinAdvance.value})`
            : 'secondary activity exempt from the minimum: no advances (Typ zálohy c)',
    );

    return {
        tax: {
            income, expenses, profit, taxBase, taxBaseRounded, incomeTax, taxpayerCredit, taxAfterCredits,
            childBenefit, childDiscount, taxAfterChild, childBonus, taxAfterBonus, bonusPayable, taxAdvancesPaid,
            taxBalance,
        },
        social: {
            socialTaxBase: taxBase, socialMonths, socialAvgMonthly, socialComputedBase, socialFloorBase, socialBase,
            socialContribution, socialAdvancesPaid, socialBalance, socialNewMonthlyBase, socialNewAdvance,
        },
        health: {
            healthTaxBase: taxBase, healthMonths, healthMinMonths, healthComputedBase, healthMinBase, healthBase,
            healthContribution, healthAdvancesPaid, healthOverpayment, healthBalance, healthNewAdvance,
        },
        trace,
    };
};
