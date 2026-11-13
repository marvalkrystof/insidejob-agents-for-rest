export type Language = 'en' | 'cs';

export type ActivityType = 'main' | 'secondary';

export type FlatRatePercent = 80 | 60 | 40 | 30;

export type Input = {
    taxYear: string;
    activityType: ActivityType;
    income: number;
    expenseMode: 'flatRate' | 'actual';
    flatRatePercent?: `${FlatRatePercent}`;
    actualExpenses?: number;
    childrenCount?: number;
    taxAdvancesPaid?: number;
    socialAdvancesPaid?: number;
    healthAdvancesPaid?: number;
    notes?: string;
    language?: Language;
};

export type Source = {
    url: string;
    quote: string;
};

export type Cited<T> = {
    value: T;
    source: Source;
};

export type Text = Record<Language, string>;

export type FormId = 'dpfo' | 'cssz' | 'vzp';

export type RowDef = {
    form: FormId;
    key: string;
    row: string;
    label: string;
    explanation: Text;
    source: Source;
};

export type Deadline = {
    form: FormId;
    what: Text;
    date: string;
    source: Source;
};

export type YearParams = {
    year: number;
    tax: {
        rateBase: Cited<number>;
        rateHigh: Cited<number>;
        highRateThreshold: Cited<number>;
        flatRateCaps: Cited<Record<FlatRatePercent, number>>;
        taxpayerCredit: Cited<number>;
        childBenefit: Cited<[number, number, number]>;
        childBonusMinIncome: Cited<number>;
        childBonusMinAmount: Cited<number>;
    };
    social: {
        assessmentShare: Cited<number>;
        rate: Cited<number>;
        minMonthlyBase: Cited<Record<ActivityType, number>>;
        maxYearlyBase: Cited<number>;
        secondaryThreshold: Cited<number>;
        nextYearMinMonthlyBase: Cited<Record<ActivityType, number>>;
        nextYearMaxMonthlyBase: Cited<number>;
    };
    health: {
        assessmentShare: Cited<number>;
        rate: Cited<number>;
        minMonthlyBase: Cited<number>;
        nextYearMinAdvance: Cited<number>;
    };
    rows: RowDef[];
    deadlines: Deadline[];
};

export type TraceStep = {
    key: string;
    value: number;
    formula: string;
};

export type Calculation = {
    tax: Record<string, number>;
    social: Record<string, number>;
    health: Record<string, number>;
    trace: TraceStep[];
};
