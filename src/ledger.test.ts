import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORIES,
  computeEqualSplit,
  computeItemizedSplit,
  computeManualSplit,
  createForgiveTransaction,
  calculateLedgerState,
  calculateMonthAnalytics,
  getTransactionBadgeText
} from '../app.js';

test('Pre-loaded 10 categories match exact variable and fixed overhead specification', () => {
  assert.equal(DEFAULT_CATEGORIES.length, 10);

  const variableNames = DEFAULT_CATEGORIES.filter((c) => !c.excludeFromBarChart).map((c) => c.name);
  const fixedNames = DEFAULT_CATEGORIES.filter((c) => c.excludeFromBarChart).map((c) => c.name);

  assert.deepEqual(variableNames, [
    'Food',
    'Travel',
    'Groceries',
    'Cigarettes',
    'Drink',
    'SIP',
    'Miscellaneous'
  ]);
  assert.deepEqual(fixedNames, ['Rent', 'Electricity', 'Househelp']);
});

test('Cash Flow vs. Personal Consumption Separation & 1-Tap Internal Transfer', () => {
  const baseState = {
    monthlyBudget: 30000,
    startingBalances: { upi: 10000, upi_lite: 1000, cash: 2000 },
    categories: DEFAULT_CATEGORIES,
    friends: [
      { id: 'f_a', name: 'Friend A' },
      { id: 'f_b', name: 'Friend B' }
    ],
    transactions: [
      // 1. Standard Personal Expense: ₹200 for Food via UPI Lite
      {
        id: 'tx1',
        type: 'expense',
        date: '2026-11-02',
        amount: 200,
        myShare: 200,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi_lite',
        isSplit: false,
        friendShares: [],
        note: 'Lunch'
      },
      // 2. Split Bill — You Paid: ₹900 via UPI for Food (Your share: ₹300, Friend A: ₹300, Friend B: ₹300)
      {
        id: 'tx2',
        type: 'expense',
        date: '2026-11-02',
        amount: 900,
        myShare: 300,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi',
        isSplit: true,
        splitMode: 'equal',
        friendShares: [
          { friendId: 'f_a', amount: 300 },
          { friendId: 'f_b', amount: 300 }
        ],
        note: 'Group Dinner'
      },
      // 3. Split Bill — Friend Paid: Friend A pays ₹600 for Food, your share is ₹200
      {
        id: 'tx3',
        type: 'expense',
        date: '2026-11-02',
        amount: 600,
        myShare: 200,
        categoryId: 'food',
        payer: 'f_a',
        accountId: null,
        isSplit: true,
        splitMode: 'equal',
        friendShares: [],
        note: 'Friend A Paid Pizza'
      },
      // 4. 1-Tap Internal Transfer: UPI -> UPI Lite ₹500 (zero impact on Today's Spend or Monthly Budget)
      {
        id: 'tx4',
        type: 'transfer',
        date: '2026-11-02',
        amount: 500,
        myShare: 0,
        fromAccountId: 'upi',
        toAccountId: 'upi_lite',
        note: 'Top up'
      }
    ]
  };

  const ledger = calculateLedgerState(baseState, '2026-11-02');

  // Verify Account Balances:
  // UPI: 10000 - 900 (tx2) - 0 (tx3 friend paid) - 500 (tx4 transfer) = 8600
  assert.equal(ledger.accountBalances.upi, 8600);
  // UPI Lite: 1000 - 200 (tx1) + 500 (tx4 transfer) = 1300
  assert.equal(ledger.accountBalances.upi_lite, 1300);
  // Physical Cash: 2000 (unchanged)
  assert.equal(ledger.accountBalances.cash, 2000);

  // Verify Today's Spend & Monthly Budget (sum of myShare only: 200 + 300 + 200 + 0 = 700)
  assert.equal(ledger.todaySpend, 700);
  assert.equal(ledger.currentMonthSpend, 700);
  assert.equal(ledger.budgetRemaining, 29300);

  // Verify Friend Netting:
  // Friend A: +300 (from tx2) - 200 (from tx3 where Friend A paid) = +100 (Friend A owes you ₹100)
  assert.equal(ledger.friendBalances['f_a'], 100);
  // Friend B: +300 (from tx2)
  assert.equal(ledger.friendBalances['f_b'], 300);

  // Verify Transaction Badges
  const friendsMap = { f_a: 'Friend A', f_b: 'Friend B' };
  const accountsMap = { upi: 'UPI', upi_lite: 'UPI Lite', cash: 'Physical Cash' };
  assert.equal(
    getTransactionBadgeText(baseState.transactions[1], friendsMap, accountsMap),
    'Paid ₹900 via UPI • Your Share: ₹300 • Split: ₹600'
  );
  assert.equal(
    getTransactionBadgeText(baseState.transactions[2], friendsMap, accountsMap),
    'Friend A paid • Your Share: ₹200'
  );
});

test('Three Split Calculation Modes: Equal, Itemized + Proportional Tax, and Manual Share', () => {
  // 1. Equal split of ₹900 among Me + 2 friends
  const eq = computeEqualSplit(900, ['f_a', 'f_b'], true);
  assert.equal(eq.isValid, true);
  assert.equal(eq.myShare, 300);
  assert.deepEqual(eq.friendShares, [
    { friendId: 'f_a', amount: 300 },
    { friendId: 'f_b', amount: 300 }
  ]);

  // Equal split with paisa rounding (₹100 / 3 = 33.34 + 33.33 + 33.33 = 100.00)
  const eqOdd = computeEqualSplit(100, ['f_a', 'f_b'], true);
  const sumOdd = eqOdd.myShare + eqOdd.friendShares[0].amount + eqOdd.friendShares[1].amount;
  assert.equal(Math.round(sumOdd * 100) / 100, 100);

  // 2. Itemized + Proportional Tax: My item ₹200, Friend A item ₹600, Tax ₹80 (Total ₹880)
  // My share = 200 + (200/800)*80 = 220; Friend A share = 600 + (600/800)*80 = 660
  const itemSplit = computeItemizedSplit(200, [{ friendId: 'f_a', baseItem: 600 }], 80);
  assert.equal(itemSplit.isValid, true);
  assert.equal(itemSplit.totalAmount, 880);
  assert.equal(itemSplit.myShare, 220);
  assert.equal(itemSplit.friendShares[0].amount, 660);

  // 3. Manual Exact Share
  const manualValid = computeManualSplit(500, 150, [
    { friendId: 'f_a', amount: 200 },
    { friendId: 'f_b', amount: 150 }
  ]);
  assert.equal(manualValid.isValid, true);
  assert.equal(manualValid.difference, 0);
});

test('Settle Up and Forgive / Round-Off Debt reconciliation', () => {
  const forgiveTx = createForgiveTransaction({
    id: 'tx_forgive_1',
    friendId: 'f_a',
    friendName: 'Friend A',
    amount: 20,
    dateISO: '2026-11-02'
  });

  assert.equal(forgiveTx.categoryId, 'miscellaneous');
  assert.equal(forgiveTx.note, 'Forgiven debt - Friend A');
  assert.equal(forgiveTx.myShare, 20);

  const state = {
    monthlyBudget: 30000,
    startingBalances: { upi: 5000, upi_lite: 500, cash: 500 },
    categories: DEFAULT_CATEGORIES,
    friends: [{ id: 'f_a', name: 'Friend A' }],
    transactions: [
      // Split bill where Friend A owes ₹300
      {
        id: 'tx_split',
        type: 'expense',
        date: '2026-11-01',
        amount: 600,
        myShare: 300,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi',
        isSplit: true,
        friendShares: [{ friendId: 'f_a', amount: 300 }],
        note: 'Dinner'
      },
      // Partial Settlement: Friend A pays ₹280 via UPI
      {
        id: 'tx_settle',
        type: 'settlement',
        date: '2026-11-02',
        amount: 280,
        myShare: 0,
        friendId: 'f_a',
        direction: 'friend_paid_me',
        accountId: 'upi',
        note: 'Partial settle'
      },
      // Forgive remaining ₹20 debt
      forgiveTx
    ]
  };

  const ledger = calculateLedgerState(state, '2026-11-02');
  // UPI: 5000 - 600 + 280 = 4680 (forgive does not deduct bank account a second time)
  assert.equal(ledger.accountBalances.upi, 4680);
  // Friend A balance: +300 - 280 - 20 = 0
  assert.equal(ledger.friendBalances['f_a'], 0);
  // Today's spend on 2026-11-02 includes the ₹20 forgiven debt under Miscellaneous
  assert.equal(ledger.todaySpend, 20);
  // Current month spend = 300 (Nov 1) + 20 (Nov 2 forgiven debt) = 320
  assert.equal(ledger.currentMonthSpend, 320);
});

test('Analytics strictly excludes Fixed Overhead categories from Category Bar Chart and computes Last Month Variance without rollover', () => {
  const state = {
    monthlyBudget: 30000,
    startingBalances: { upi: 50000, upi_lite: 1000, cash: 1000 },
    categories: DEFAULT_CATEGORIES,
    friends: [],
    transactions: [
      // Last month (Oct 2026): ₹28,550 spend => ₹1,450 Under Budget
      {
        id: 'oct_1',
        type: 'expense',
        date: '2026-10-05',
        amount: 28550,
        myShare: 28550,
        categoryId: 'rent',
        payer: 'me',
        accountId: 'upi',
        isSplit: false
      },
      // Current month (Nov 2026): Rent ₹15,000 (Fixed), Electricity ₹1,500 (Fixed), Food ₹2,500 (Variable)
      {
        id: 'nov_1',
        type: 'expense',
        date: '2026-11-01',
        amount: 15000,
        myShare: 15000,
        categoryId: 'rent',
        payer: 'me',
        accountId: 'upi',
        isSplit: false
      },
      {
        id: 'nov_2',
        type: 'expense',
        date: '2026-11-01',
        amount: 1500,
        myShare: 1500,
        categoryId: 'electricity',
        payer: 'me',
        accountId: 'upi',
        isSplit: false
      },
      {
        id: 'nov_3',
        type: 'expense',
        date: '2026-11-02',
        amount: 2500,
        myShare: 2500,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi',
        isSplit: false
      }
    ]
  };

  const ledger = calculateLedgerState(state, '2026-11-02');
  assert.equal(ledger.lastMonthVariance.badgeText, 'Last Month (Oct): ₹1,450 Under Budget');
  assert.equal(ledger.lastMonthVariance.isUnderBudget, true);
  // Current month budget cap remains 30,000 (no rollover)
  assert.equal(ledger.monthlyBudget, 30000);
  assert.equal(ledger.currentMonthSpend, 19000);
  assert.equal(ledger.budgetRemaining, 11000);

  const analytics = calculateMonthAnalytics(state, '2026-11');
  assert.equal(analytics.totalMonthlySpend, 19000);
  assert.equal(analytics.fixedOverheadSpend, 16500);
  assert.equal(analytics.variableSpend, 2500);

  // Category Horizontal Bar Chart must contain ONLY the 7 variable categories and ZERO fixed overhead categories
  const barCategoryIds = analytics.categoryChartBars.map((b) => b.categoryId);
  assert.equal(barCategoryIds.includes('rent'), false);
  assert.equal(barCategoryIds.includes('electricity'), false);
  assert.equal(barCategoryIds.includes('househelp'), false);
  assert.equal(barCategoryIds.includes('food'), true);
});
