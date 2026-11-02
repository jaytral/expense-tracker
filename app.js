/**
 * RupeeLedger — Personal Expense Tracker, Live Multi-Account Ledger & Offline Splitwise PWA
 * Standalone Zero-Build Application Engine (./app.js)
 */

export const STORAGE_KEY = 'rupeeledger_state_v1';
export const IDB_NAME = 'RupeeLedgerDB';
export const IDB_VERSION = 1;
export const IDB_STORE = 'ledger_store';

export const ACCOUNTS = [
  { id: 'upi', name: 'UPI', subtitle: 'Primary Bank', icon: 'landmark' },
  { id: 'upi_lite', name: 'UPI Lite', subtitle: 'Fast Pinless', icon: 'smartphone' },
  { id: 'cash', name: 'Physical Cash', subtitle: 'Wallet Notes', icon: 'banknote' }
];

export const DEFAULT_CATEGORIES = [
  // Variable Categories (excludeFromBarChart: false — Counted in Monthly Budget AND displayed in Category Bar Chart)
  { id: 'food', name: 'Food', icon: 'utensils', excludeFromBarChart: false, isSystem: true },
  { id: 'travel', name: 'Travel', icon: 'car', excludeFromBarChart: false, isSystem: true },
  { id: 'groceries', name: 'Groceries', icon: 'shopping-basket', excludeFromBarChart: false, isSystem: true },
  { id: 'cigarettes', name: 'Cigarettes', icon: 'flame', excludeFromBarChart: false, isSystem: true },
  { id: 'drink', name: 'Drink', icon: 'wine', excludeFromBarChart: false, isSystem: true },
  { id: 'sip', name: 'SIP', icon: 'trending-up', excludeFromBarChart: false, isSystem: true },
  { id: 'miscellaneous', name: 'Miscellaneous', icon: 'layers', excludeFromBarChart: false, isSystem: true },
  // Fixed Overhead Categories (excludeFromBarChart: true — Counted in Monthly Budget, SILENTLY EXCLUDED from Category Bar Chart)
  { id: 'rent', name: 'Rent', icon: 'home', excludeFromBarChart: true, isSystem: true },
  { id: 'electricity', name: 'Electricity', icon: 'zap', excludeFromBarChart: true, isSystem: true },
  { id: 'househelp', name: 'Househelp', icon: 'sparkles', excludeFromBarChart: true, isSystem: true }
];

// ============================================================================
// 1. PURE MATHEMATICAL & ACCOUNTING RECONCILIATION ENGINE
// ============================================================================

export function roundCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function formatINR(value, showSign = false) {
  const num = roundCurrency(value);
  const abs = Math.abs(num);
  const hasDecimals = Math.round((abs % 1) * 100) !== 0;
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  });
  if (showSign) {
    if (num > 0) return `+₹${formatted}`;
    if (num < 0) return `-₹${formatted}`;
    return `₹${formatted}`;
  }
  return num < 0 ? `-₹${formatted}` : `₹${formatted}`;
}

export function getTodayISO(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousMonthISO(monthISO) {
  const [yStr, mStr] = monthISO.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getNextMonthISO(monthISO) {
  const [yStr, mStr] = monthISO.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatMonthShort(monthISO) {
  const [yStr, mStr] = monthISO.split('-');
  const date = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short' });
}

export function formatMonthYear(monthISO) {
  const [yStr, mStr] = monthISO.split('-');
  const date = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function getDaysInMonth(monthISO) {
  const [yStr, mStr] = monthISO.split('-');
  return new Date(parseInt(yStr, 10), parseInt(mStr, 10), 0).getDate();
}

/**
 * Mode 1: Equal Split Calculation
 * Divides totalAmount equally among selected friendIds (plus user if includeMe === true).
 * Any 1-paisa rounding remainder is absorbed by the first participant so shares sum to totalAmount.
 */
export function computeEqualSplit(totalAmount, friendIds, includeMe = true) {
  const total = roundCurrency(totalAmount);
  const cleanFriends = Array.isArray(friendIds) ? friendIds.filter(Boolean) : [];
  const participantCount = cleanFriends.length + (includeMe ? 1 : 0);

  if (participantCount <= 0 || total <= 0) {
    return {
      totalAmount: total,
      myShare: 0,
      friendShares: cleanFriends.map((id) => ({ friendId: id, amount: 0 })),
      isValid: false
    };
  }

  const baseShare = Math.floor((total / participantCount) * 100) / 100;
  const shares = new Array(participantCount).fill(baseShare);
  const currentSum = roundCurrency(baseShare * participantCount);
  const remainder = roundCurrency(total - currentSum);

  if (remainder !== 0) {
    shares[0] = roundCurrency(shares[0] + remainder);
  }

  const myShare = includeMe ? shares[0] : 0;
  const friendShares = cleanFriends.map((friendId, idx) => ({
    friendId,
    amount: shares[includeMe ? idx + 1 : idx]
  }));

  return {
    totalAmount: total,
    myShare,
    friendShares,
    isValid: cleanFriends.length > 0 && total > 0
  };
}

/**
 * Mode 2: Itemized + Proportional Tax/Charges Split Calculation
 * Distributes taxOrExtra proportionally based on each person's base item subtotal.
 */
export function computeItemizedSplit(myBaseItem, friendItems, taxOrExtra = 0) {
  const myBase = Math.max(0, roundCurrency(myBaseItem));
  const tax = Math.max(0, roundCurrency(taxOrExtra));
  const cleanFriendItems = (Array.isArray(friendItems) ? friendItems : []).map((f) => ({
    friendId: f.friendId,
    baseItem: Math.max(0, roundCurrency(f.baseItem))
  }));

  const friendsBaseSum = cleanFriendItems.reduce((acc, f) => roundCurrency(acc + f.baseItem), 0);
  const itemSubtotal = roundCurrency(myBase + friendsBaseSum);
  const totalAmount = roundCurrency(itemSubtotal + tax);

  if (itemSubtotal <= 0) {
    return {
      itemSubtotal: 0,
      taxOrExtra: tax,
      totalAmount: 0,
      myShare: 0,
      friendShares: cleanFriendItems.map((f) => ({
        friendId: f.friendId,
        baseItem: 0,
        taxShare: 0,
        amount: 0
      })),
      isValid: false
    };
  }

  const myRawTax = (myBase / itemSubtotal) * tax;
  let myShare = roundCurrency(myBase + myRawTax);

  const friendShares = cleanFriendItems.map((f) => {
    const rawTax = (f.baseItem / itemSubtotal) * tax;
    const amount = roundCurrency(f.baseItem + rawTax);
    return {
      friendId: f.friendId,
      baseItem: f.baseItem,
      taxShare: roundCurrency(amount - f.baseItem),
      amount
    };
  });

  // Reconcile any rounding difference so myShare + sum(friendShares) === totalAmount
  const allocatedSum = roundCurrency(
    myShare + friendShares.reduce((acc, f) => roundCurrency(acc + f.amount), 0)
  );
  const diff = roundCurrency(totalAmount - allocatedSum);

  if (diff !== 0) {
    if (myBase > 0) {
      myShare = roundCurrency(myShare + diff);
    } else {
      const firstActiveFriend = friendShares.find((f) => f.baseItem > 0);
      if (firstActiveFriend) {
        firstActiveFriend.amount = roundCurrency(firstActiveFriend.amount + diff);
      }
    }
  }

  const hasFriendShare = friendShares.some((f) => f.amount > 0);
  return {
    itemSubtotal,
    taxOrExtra: tax,
    totalAmount,
    myShare,
    friendShares,
    isValid: totalAmount > 0 && hasFriendShare
  };
}

/**
 * Mode 3: Manual Exact Share Split Calculation
 * Validates or auto-adjusts exact rupee shares so they sum to totalAmount.
 */
export function computeManualSplit(totalAmount, myManualShare, friendManualShares) {
  const total = roundCurrency(totalAmount);
  const myShare = Math.max(0, roundCurrency(myManualShare));
  const friendShares = (Array.isArray(friendManualShares) ? friendManualShares : []).map((f) => ({
    friendId: f.friendId,
    amount: Math.max(0, roundCurrency(f.amount))
  }));

  const friendsSum = friendShares.reduce((acc, f) => roundCurrency(acc + f.amount), 0);
  const allocatedTotal = roundCurrency(myShare + friendsSum);
  const difference = roundCurrency(total - allocatedTotal);
  const hasFriendShare = friendShares.some((f) => f.amount > 0);

  return {
    totalAmount: total,
    myShare,
    friendShares,
    friendsSum,
    allocatedTotal,
    difference,
    isValid: total > 0 && hasFriendShare && Math.abs(difference) < 0.01
  };
}

/**
 * Creates a Forgive / Round-Off Debt transaction object.
 * Reduces friend's balance by `amount` and records a personal expense under `miscellaneous`
 * with auto-note `"Forgiven debt - [Friend Name]"` on `dateISO`.
 */
export function createForgiveTransaction({ id, friendId, friendName, amount, dateISO, createdAt }) {
  const cleanAmount = roundCurrency(amount);
  return {
    id: id || `tx_forgive_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'forgive',
    date: dateISO,
    createdAt: createdAt || Date.now(),
    amount: cleanAmount,
    myShare: cleanAmount,
    categoryId: 'miscellaneous',
    friendId,
    accountId: null,
    payer: 'me',
    isSplit: false,
    splitMode: 'none',
    friendShares: [],
    note: `Forgiven debt - ${friendName}`
  };
}

/**
 * Single Source-of-Truth Ledger Reconciliation
 * Dynamically computes:
 * - Live Account Balances (UPI, UPI Lite, Physical Cash)
 * - Friend Net Balances & Per-Friend Ledger Histories
 * - Today's Spend (sum of myShare on todayISO)
 * - Current Month Budget Progress (sum of myShare in currentMonthISO)
 * - Persistent Last Month Variance Badge (lastMonthISO total myShare vs monthlyBudget)
 */
export function calculateLedgerState(state, todayISO = getTodayISO()) {
  const starting = state.startingBalances || { upi: 0, upi_lite: 0, cash: 0 };
  const accountBalances = {
    upi: roundCurrency(starting.upi || 0),
    upi_lite: roundCurrency(starting.upi_lite || 0),
    cash: roundCurrency(starting.cash || 0)
  };

  const friendBalances = {};
  const friendHistories = {};
  (state.friends || []).forEach((f) => {
    friendBalances[f.id] = 0;
    friendHistories[f.id] = [];
  });

  const currentMonthISO = todayISO.slice(0, 7);
  const lastMonthISO = getPreviousMonthISO(currentMonthISO);

  let todaySpend = 0;
  let currentMonthSpend = 0;
  let lastMonthSpend = 0;
  let lastMonthTxCount = 0;

  // Sort transactions chronologically (oldest -> newest) for running history,
  // and also provide newestFirst for the master feed.
  const allTransactions = Array.isArray(state.transactions) ? [...state.transactions] : [];
  const chronological = [...allTransactions].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  for (const tx of chronological) {
    const amount = roundCurrency(tx.amount);
    const txMonth = (tx.date || '').slice(0, 7);

    if (tx.type === 'expense') {
      const myShare = roundCurrency(tx.myShare !== undefined ? tx.myShare : amount);
      const payer = tx.payer || 'me';

      // 1. Account Cash Flow Impact
      if (payer === 'me' && tx.accountId && accountBalances[tx.accountId] !== undefined) {
        accountBalances[tx.accountId] = roundCurrency(accountBalances[tx.accountId] - amount);
      }

      // 2. Personal Consumption Impact (myShare)
      if (tx.date === todayISO) {
        todaySpend = roundCurrency(todaySpend + myShare);
      }
      if (txMonth === currentMonthISO) {
        currentMonthSpend = roundCurrency(currentMonthSpend + myShare);
      } else if (txMonth === lastMonthISO) {
        lastMonthSpend = roundCurrency(lastMonthSpend + myShare);
        lastMonthTxCount += 1;
      }

      // 3. Peer-to-Peer Splitwise Friend Netting
      if (payer === 'me' && tx.isSplit && Array.isArray(tx.friendShares)) {
        for (const fs of tx.friendShares) {
          const fShare = roundCurrency(fs.amount);
          if (fShare > 0 && fs.friendId) {
            if (friendBalances[fs.friendId] === undefined) {
              friendBalances[fs.friendId] = 0;
              friendHistories[fs.friendId] = [];
            }
            friendBalances[fs.friendId] = roundCurrency(friendBalances[fs.friendId] + fShare);
            friendHistories[fs.friendId].push({
              txId: tx.id,
              date: tx.date,
              type: 'split_you_paid',
              note: tx.note || 'Split Expense',
              totalBill: amount,
              delta: +fShare,
              runningBalance: friendBalances[fs.friendId]
            });
          }
        }
      } else if (payer !== 'me') {
        // Friend paid the bill: our accounts change by ₹0, our personal consumption went up by +myShare,
        // and our net balance with that friend decreases by -myShare.
        const friendId = payer;
        if (myShare > 0 && friendId) {
          if (friendBalances[friendId] === undefined) {
            friendBalances[friendId] = 0;
            friendHistories[friendId] = [];
          }
          friendBalances[friendId] = roundCurrency(friendBalances[friendId] - myShare);
          friendHistories[friendId].push({
            txId: tx.id,
            date: tx.date,
            type: 'split_friend_paid',
            note: tx.note || 'Friend Paid Bill',
            totalBill: amount,
            delta: -myShare,
            runningBalance: friendBalances[friendId]
          });
        }
      }
    } else if (tx.type === 'forgive') {
      // Forgive / Round-Off Debt:
      // Reduces friend's positive balance by `amount` AND counts `amount` as personal expense under Miscellaneous
      // with zero impact on UPI / UPI Lite / Cash accounts.
      const forgiveAmt = roundCurrency(tx.myShare !== undefined ? tx.myShare : amount);
      if (tx.date === todayISO) {
        todaySpend = roundCurrency(todaySpend + forgiveAmt);
      }
      if (txMonth === currentMonthISO) {
        currentMonthSpend = roundCurrency(currentMonthSpend + forgiveAmt);
      } else if (txMonth === lastMonthISO) {
        lastMonthSpend = roundCurrency(lastMonthSpend + forgiveAmt);
        lastMonthTxCount += 1;
      }

      if (tx.friendId) {
        if (friendBalances[tx.friendId] === undefined) {
          friendBalances[tx.friendId] = 0;
          friendHistories[tx.friendId] = [];
        }
        friendBalances[tx.friendId] = roundCurrency(friendBalances[tx.friendId] - forgiveAmt);
        friendHistories[tx.friendId].push({
          txId: tx.id,
          date: tx.date,
          type: 'forgive',
          note: tx.note || 'Forgiven debt',
          totalBill: forgiveAmt,
          delta: -forgiveAmt,
          runningBalance: friendBalances[tx.friendId]
        });
      }
    } else if (tx.type === 'transfer') {
      // 1-Tap Internal Transfer: deducts from source, adds to destination, ZERO impact on Today's Spend or Monthly Budget
      if (tx.fromAccountId && accountBalances[tx.fromAccountId] !== undefined) {
        accountBalances[tx.fromAccountId] = roundCurrency(accountBalances[tx.fromAccountId] - amount);
      }
      if (tx.toAccountId && accountBalances[tx.toAccountId] !== undefined) {
        accountBalances[tx.toAccountId] = roundCurrency(accountBalances[tx.toAccountId] + amount);
      }
    } else if (tx.type === 'income') {
      // External money received (Add Balance / Income): adds to destination account, ZERO impact on spend
      if (tx.accountId && accountBalances[tx.accountId] !== undefined) {
        accountBalances[tx.accountId] = roundCurrency(accountBalances[tx.accountId] + amount);
      }
    } else if (tx.type === 'settlement') {
      // Peer-to-peer Settlement: updates Account Balance and Friend Net Balance, ZERO impact on Personal Spend or Budget
      const friendId = tx.friendId;
      const direction = tx.direction || 'friend_paid_me';

      if (direction === 'friend_paid_me') {
        if (tx.accountId && accountBalances[tx.accountId] !== undefined) {
          accountBalances[tx.accountId] = roundCurrency(accountBalances[tx.accountId] + amount);
        }
        if (friendId) {
          if (friendBalances[friendId] === undefined) {
            friendBalances[friendId] = 0;
            friendHistories[friendId] = [];
          }
          friendBalances[friendId] = roundCurrency(friendBalances[friendId] - amount);
          friendHistories[friendId].push({
            txId: tx.id,
            date: tx.date,
            type: 'settlement_received',
            note: tx.note || 'Settled up (Paid you)',
            totalBill: amount,
            accountId: tx.accountId,
            delta: -amount,
            runningBalance: friendBalances[friendId]
          });
        }
      } else {
        // i_paid_friend
        if (tx.accountId && accountBalances[tx.accountId] !== undefined) {
          accountBalances[tx.accountId] = roundCurrency(accountBalances[tx.accountId] - amount);
        }
        if (friendId) {
          if (friendBalances[friendId] === undefined) {
            friendBalances[friendId] = 0;
            friendHistories[friendId] = [];
          }
          friendBalances[friendId] = roundCurrency(friendBalances[friendId] + amount);
          friendHistories[friendId].push({
            txId: tx.id,
            date: tx.date,
            type: 'settlement_paid',
            note: tx.note || 'Settled up (You paid)',
            totalBill: amount,
            accountId: tx.accountId,
            delta: +amount,
            runningBalance: friendBalances[friendId]
          });
        }
      }
    }
  }

  // Reverse per-friend histories so newest is at top when expanded
  Object.keys(friendHistories).forEach((fid) => {
    friendHistories[fid].reverse();
  });

  let totalOwedToYou = 0;
  let totalYouOwe = 0;
  Object.values(friendBalances).forEach((bal) => {
    const rounded = roundCurrency(bal);
    if (rounded > 0) totalOwedToYou = roundCurrency(totalOwedToYou + rounded);
    if (rounded < 0) totalYouOwe = roundCurrency(totalYouOwe + Math.abs(rounded));
  });
  const netFriendBalance = roundCurrency(totalOwedToYou - totalYouOwe);

  const monthlyBudget = roundCurrency(state.monthlyBudget || 30000);
  const budgetRemaining = roundCurrency(monthlyBudget - currentMonthSpend);
  const budgetUtilizationPct = monthlyBudget > 0
    ? Math.min(100, Math.round((currentMonthSpend / monthlyBudget) * 100))
    : 0;

  // Persistent Last Month Variance Badge calculation (does NOT roll over into current month's budget)
  const lastMonthDiff = roundCurrency(monthlyBudget - lastMonthSpend);
  const lastMonthVariance = {
    monthISO: lastMonthISO,
    monthLabel: formatMonthShort(lastMonthISO),
    totalSpend: lastMonthSpend,
    budget: monthlyBudget,
    varianceAmount: Math.abs(lastMonthDiff),
    signedVariance: lastMonthDiff,
    isUnderBudget: lastMonthDiff >= 0,
    hasTransactions: lastMonthTxCount > 0,
    badgeText: `Last Month (${formatMonthShort(lastMonthISO)}): ${formatINR(Math.abs(lastMonthDiff))} ${
      lastMonthDiff >= 0 ? 'Under Budget' : 'Over Budget'
    }`
  };

  const newestFirstTransactions = [...allTransactions].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return {
    accountBalances: {
      ...accountBalances,
      total: roundCurrency(accountBalances.upi + accountBalances.upi_lite + accountBalances.cash)
    },
    friendBalances,
    friendHistories,
    friendSummary: {
      totalOwedToYou,
      totalYouOwe,
      netBalance: netFriendBalance
    },
    todaySpend,
    currentMonthISO,
    currentMonthSpend,
    monthlyBudget,
    budgetRemaining,
    budgetUtilizationPct,
    isOverBudget: currentMonthSpend > monthlyBudget,
    lastMonthVariance,
    newestFirstTransactions
  };
}

/**
 * Calculates Monthly Analytics for any selected `YYYY-MM` month:
 * - Total Monthly Spend (Variable + Fixed Overhead)
 * - Fixed Overhead Spend (categories with excludeFromBarChart: true)
 * - Variable Spend (categories with excludeFromBarChart: false)
 * - Category Horizontal Bar Chart data (strictly excluding categories with excludeFromBarChart: true)
 * - Daily Spend Bar Chart data (days 1..30/31)
 */
export function calculateMonthAnalytics(state, monthISO) {
  const categories = Array.isArray(state.categories) && state.categories.length > 0
    ? state.categories
    : DEFAULT_CATEGORIES;

  const categoryMap = {};
  categories.forEach((cat) => {
    categoryMap[cat.id] = {
      ...cat,
      spend: 0,
      txCount: 0
    };
  });

  const daysCount = getDaysInMonth(monthISO);
  const dailyTotals = new Array(daysCount).fill(0);

  let totalMonthlySpend = 0;
  let fixedOverheadSpend = 0;
  let variableSpend = 0;

  const transactions = Array.isArray(state.transactions) ? state.transactions : [];
  for (const tx of transactions) {
    if (tx.type !== 'expense' && tx.type !== 'forgive') continue;
    if (!tx.date || tx.date.slice(0, 7) !== monthISO) continue;

    const myShare = roundCurrency(tx.myShare !== undefined ? tx.myShare : tx.amount);
    if (myShare <= 0) continue;

    const catId = tx.type === 'forgive' ? 'miscellaneous' : (tx.categoryId || 'miscellaneous');
    const catObj = categoryMap[catId] || categoryMap['miscellaneous'] || {
      id: catId,
      name: catId,
      icon: 'layers',
      excludeFromBarChart: false,
      spend: 0,
      txCount: 0
    };

    catObj.spend = roundCurrency(catObj.spend + myShare);
    catObj.txCount += 1;
    categoryMap[catObj.id] = catObj;

    totalMonthlySpend = roundCurrency(totalMonthlySpend + myShare);
    if (catObj.excludeFromBarChart) {
      fixedOverheadSpend = roundCurrency(fixedOverheadSpend + myShare);
    } else {
      variableSpend = roundCurrency(variableSpend + myShare);
    }

    const dayNum = parseInt(tx.date.slice(8, 10), 10);
    if (dayNum >= 1 && dayNum <= daysCount) {
      dailyTotals[dayNum - 1] = roundCurrency(dailyTotals[dayNum - 1] + myShare);
    }
  }

  // Strictly filter out fixed overhead categories (excludeFromBarChart: true) from the Category Horizontal Bar Chart
  const variableCategories = Object.values(categoryMap).filter((c) => !c.excludeFromBarChart);
  const maxCategorySpend = Math.max(...variableCategories.map((c) => c.spend), 0);

  const categoryChartBars = variableCategories
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      spend: c.spend,
      txCount: c.txCount,
      pctOfVariable: variableSpend > 0 ? roundCurrency((c.spend / variableSpend) * 100) : 0,
      barWidthPct: maxCategorySpend > 0 ? Math.max(c.spend > 0 ? 4 : 0, Math.round((c.spend / maxCategorySpend) * 100)) : 0
    }));

  const fixedCategories = Object.values(categoryMap)
    .filter((c) => c.excludeFromBarChart)
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      spend: c.spend,
      txCount: c.txCount
    }));

  const maxDailySpend = Math.max(...dailyTotals, 0);
  const dailyChartBars = dailyTotals.map((amt, idx) => {
    const day = idx + 1;
    const dateISO = `${monthISO}-${String(day).padStart(2, '0')}`;
    return {
      day,
      dateISO,
      spend: amt,
      barHeightPct: maxDailySpend > 0 ? Math.max(amt > 0 ? 6 : 0, Math.round((amt / maxDailySpend) * 100)) : 0
    };
  });

  return {
    monthISO,
    monthLabel: formatMonthYear(monthISO),
    totalMonthlySpend,
    fixedOverheadSpend,
    variableSpend,
    categoryChartBars,
    fixedCategories,
    dailyChartBars,
    maxDailySpend
  };
}

/**
 * Formats the exact required transaction row badge text for any transaction
 */
export function getTransactionBadgeText(tx, friendsMap = {}, accountsMap = {}) {
  const accName = (id) => accountsMap[id] || (id === 'upi' ? 'UPI' : id === 'upi_lite' ? 'UPI Lite' : id === 'cash' ? 'Physical Cash' : 'Account');
  const friendName = (id) => friendsMap[id] || 'Friend';

  if (tx.type === 'expense') {
    const total = roundCurrency(tx.amount);
    const myShare = roundCurrency(tx.myShare !== undefined ? tx.myShare : total);
    const payer = tx.payer || 'me';

    if (payer === 'me') {
      if (tx.isSplit) {
        const splitPortion = roundCurrency(total - myShare);
        return `Paid ${formatINR(total)} via ${accName(tx.accountId)} • Your Share: ${formatINR(myShare)} • Split: ${formatINR(splitPortion)}`;
      }
      return `Paid ${formatINR(total)} via ${accName(tx.accountId)} • Your Share: ${formatINR(myShare)}`;
    } else {
      return `${friendName(payer)} paid • Your Share: ${formatINR(myShare)}`;
    }
  }

  if (tx.type === 'forgive') {
    return `Forgiven Debt (${friendName(tx.friendId)}) • Your Share: ${formatINR(tx.myShare || tx.amount)}`;
  }

  if (tx.type === 'transfer') {
    return `1-Tap Transfer: ${accName(tx.fromAccountId)} → ${accName(tx.toAccountId)} • ₹0 Budget Impact`;
  }

  if (tx.type === 'income') {
    return `External Balance Added to ${accName(tx.accountId)} • ₹0 Spend Impact`;
  }

  if (tx.type === 'settlement') {
    if (tx.direction === 'friend_paid_me') {
      return `${friendName(tx.friendId)} settled up → ${accName(tx.accountId)} • ₹0 Budget Impact`;
    }
    return `You settled up with ${friendName(tx.friendId)} via ${accName(tx.accountId)} • ₹0 Budget Impact`;
  }

  return '';
}

// ============================================================================
// 2. DETERMINISTIC INITIAL SEED DATA (Relative to Current Date)
// ============================================================================

export function createInitialSeedState(todayISO = getTodayISO()) {
  const currentMonthISO = todayISO.slice(0, 7);
  const lastMonthISO = getPreviousMonthISO(currentMonthISO);
  const dayNum = parseInt(todayISO.slice(8, 10), 10);
  const yesterdayISO = dayNum > 1
    ? `${currentMonthISO}-${String(dayNum - 1).padStart(2, '0')}`
    : `${currentMonthISO}-01`;

  return {
    version: 1,
    monthlyBudget: 30000,
    startingBalances: {
      upi: 48000,
      upi_lite: 1200,
      cash: 3500
    },
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    friends: [
      { id: 'f_aarav', name: 'Aarav Sharma', createdAt: 1730000100000 },
      { id: 'f_priya', name: 'Priya Patel', createdAt: 1730000200000 },
      { id: 'f_rohan', name: 'Rohan Verma', createdAt: 1730000300000 }
    ],
    transactions: [
      // --- LAST CALENDAR MONTH TRANSACTIONS (Total myShare = ₹28,550 vs ₹30,000 budget => ₹1,450 Under Budget) ---
      {
        id: 'tx_seed_oct_1',
        type: 'expense',
        date: `${lastMonthISO}-02`,
        createdAt: 1727850000000,
        amount: 14500,
        myShare: 14500,
        categoryId: 'rent',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Monthly Apartment Rent (Oct)'
      },
      {
        id: 'tx_seed_oct_2',
        type: 'expense',
        date: `${lastMonthISO}-05`,
        createdAt: 1728100000000,
        amount: 5000,
        myShare: 5000,
        categoryId: 'sip',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Nifty 50 Index Monthly SIP'
      },
      {
        id: 'tx_seed_oct_3',
        type: 'expense',
        date: `${lastMonthISO}-10`,
        createdAt: 1728500000000,
        amount: 2400,
        myShare: 2400,
        categoryId: 'househelp',
        payer: 'me',
        accountId: 'cash',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Cook & Maid Monthly Salary'
      },
      {
        id: 'tx_seed_oct_4',
        type: 'expense',
        date: `${lastMonthISO}-14`,
        createdAt: 1728900000000,
        amount: 1650,
        myShare: 1650,
        categoryId: 'electricity',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'BESCOM Electricity Bill'
      },
      {
        id: 'tx_seed_oct_5',
        type: 'expense',
        date: `${lastMonthISO}-19`,
        createdAt: 1729300000000,
        amount: 3200,
        myShare: 3200,
        categoryId: 'groceries',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Monthly Groceries & Staples'
      },
      {
        id: 'tx_seed_oct_6',
        type: 'expense',
        date: `${lastMonthISO}-25`,
        createdAt: 1729800000000,
        amount: 1800,
        myShare: 1800,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Weekend Dining & Coffee Runs'
      },

      // --- CURRENT MONTH TRANSACTIONS ---
      {
        id: 'tx_seed_nov_1',
        type: 'expense',
        date: `${currentMonthISO}-01`,
        createdAt: 1730448000000,
        amount: 14500,
        myShare: 14500,
        categoryId: 'rent',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Apartment Rent'
      },
      {
        id: 'tx_seed_nov_2',
        type: 'expense',
        date: `${currentMonthISO}-01`,
        createdAt: 1730452000000,
        amount: 1420,
        myShare: 1420,
        categoryId: 'electricity',
        payer: 'me',
        accountId: 'upi',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Electricity Bill'
      },
      {
        id: 'tx_seed_nov_3',
        type: 'transfer',
        date: yesterdayISO,
        createdAt: 1730460000000,
        amount: 1000,
        myShare: 0,
        fromAccountId: 'upi',
        toAccountId: 'upi_lite',
        note: 'UPI Lite Top-Up'
      },
      {
        id: 'tx_seed_nov_4',
        type: 'expense',
        date: yesterdayISO,
        createdAt: 1730470000000,
        amount: 900,
        myShare: 300,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi',
        isSplit: true,
        splitMode: 'equal',
        friendShares: [
          { friendId: 'f_aarav', amount: 300 },
          { friendId: 'f_priya', amount: 300 }
        ],
        note: 'Biryani & Kebabs Dinner'
      },
      {
        id: 'tx_seed_nov_5',
        type: 'expense',
        date: yesterdayISO,
        createdAt: 1730480000000,
        amount: 600,
        myShare: 200,
        categoryId: 'travel',
        payer: 'f_rohan',
        accountId: null,
        isSplit: true,
        splitMode: 'equal',
        friendShares: [],
        note: 'Airport Uber Cab (Rohan Paid)'
      },
      // --- TODAY'S TRANSACTIONS ---
      {
        id: 'tx_seed_today_1',
        type: 'expense',
        date: todayISO,
        createdAt: 1730530000000,
        amount: 240,
        myShare: 240,
        categoryId: 'food',
        payer: 'me',
        accountId: 'upi_lite',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Masala Dosa & Filter Coffee'
      },
      {
        id: 'tx_seed_today_2',
        type: 'expense',
        date: todayISO,
        createdAt: 1730536000000,
        amount: 680,
        myShare: 680,
        categoryId: 'groceries',
        payer: 'me',
        accountId: 'upi_lite',
        isSplit: false,
        splitMode: 'none',
        friendShares: [],
        note: 'Fresh Milk, Eggs & Avocados'
      }
    ]
  };
}

// ============================================================================
// 3. PERSISTENCE ENGINE (IndexedDB + localStorage Dual-Layer Sync)
// ============================================================================

class StorageEngine {
  constructor() {
    this.dbPromise = null;
  }

  initIDB() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => resolve(null);
      } catch (_err) {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  loadSync() {
    if (typeof localStorage === 'undefined') return createInitialSeedState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.transactions)) {
          return this.normalizeState(parsed);
        }
      }
    } catch (_err) {
      // Fallback to seed state
    }
    const seeded = createInitialSeedState();
    this.saveSync(seeded);
    return seeded;
  }

  async syncFromIDBIfEmpty() {
    const db = await this.initIDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(STORAGE_KEY);
        req.onsuccess = () => {
          if (req.result && Array.isArray(req.result.transactions)) {
            resolve(this.normalizeState(req.result));
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (_err) {
        resolve(null);
      }
    });
  }

  saveSync(state) {
    const normalized = this.normalizeState(state);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch (_err) {
        // Ignore quota errors
      }
    }
    this.saveToIDB(normalized);
    return normalized;
  }

  async saveToIDB(state) {
    const db = await this.initIDB();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, STORAGE_KEY);
    } catch (_err) {
      // Ignore IDB write error
    }
  }

  normalizeState(state) {
    const seed = createInitialSeedState();
    const existingCats = Array.isArray(state.categories) ? state.categories : [];
    const mergedCategories = [...DEFAULT_CATEGORIES];

    // Preserve user custom categories and any excludeFromBarChart overrides
    for (const c of existingCats) {
      const idx = mergedCategories.findIndex((dc) => dc.id === c.id);
      if (idx >= 0) {
        mergedCategories[idx] = { ...mergedCategories[idx], excludeFromBarChart: Boolean(c.excludeFromBarChart) };
      } else if (c.id && c.name) {
        mergedCategories.push({
          id: c.id,
          name: c.name,
          icon: c.icon || 'tag',
          excludeFromBarChart: Boolean(c.excludeFromBarChart),
          isSystem: false
        });
      }
    }

    return {
      version: 1,
      monthlyBudget: roundCurrency(state.monthlyBudget !== undefined ? state.monthlyBudget : seed.monthlyBudget),
      startingBalances: {
        upi: roundCurrency(state.startingBalances?.upi ?? seed.startingBalances.upi),
        upi_lite: roundCurrency(state.startingBalances?.upi_lite ?? seed.startingBalances.upi_lite),
        cash: roundCurrency(state.startingBalances?.cash ?? seed.startingBalances.cash)
      },
      categories: mergedCategories,
      friends: Array.isArray(state.friends) ? state.friends : seed.friends,
      transactions: Array.isArray(state.transactions) ? state.transactions : seed.transactions
    };
  }
}

// ============================================================================
// 4. BROWSER UI APPLICATION CONTROLLER
// ============================================================================

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const storage = new StorageEngine();
  let appState = storage.loadSync();

  const ui = {
    activeTab: 'home', // 'home' | 'friends' | 'analytics' | 'settings'
    searchQuery: '',
    txFilter: 'all', // 'all' | 'expense' | 'split' | 'transfer' | 'settlement'
    analyticsMonthISO: getTodayISO().slice(0, 7),
    expandedFriendIds: {},
    toastMessage: null,
    toastTimer: null,
    confirmDeleteTxId: null,
    confirmResetMode: null, // 'demo' | 'clear' | null

    // Add / Edit Modal State
    modalOpen: false,
    modalTab: 'expense', // 'expense' | 'transfer' | 'income'
    editingTxId: null,

    // Expense Form State
    expAmount: '',
    expDate: getTodayISO(),
    expCategoryId: 'food',
    expPayer: 'me', // 'me' or friendId
    expAccountId: 'upi', // 'upi' | 'upi_lite' | 'cash'
    expIsSplit: false,
    expSplitMode: 'equal', // 'equal' | 'itemized' | 'manual'
    expEqualIncludeMe: true,
    expSelectedFriends: {}, // { [friendId]: boolean }
    expMyBaseItem: '',
    expFriendBaseItems: {}, // { [friendId]: string }
    expTaxOrExtra: '',
    expMyManualShare: '',
    expFriendManualShares: {}, // { [friendId]: string }
    expNote: '',
    expError: '',

    // Transfer Form State
    trfPreset: 'upi_to_lite', // 'upi_to_lite' | 'upi_to_cash' | 'custom'
    trfFromAccount: 'upi',
    trfToAccount: 'upi_lite',
    trfAmount: '',
    trfDate: getTodayISO(),
    trfNote: '',
    trfError: '',

    // Add Balance (Income) Form State
    incAccount: 'upi',
    incAmount: '',
    incDate: getTodayISO(),
    incNote: '',
    incError: '',

    // Friend Settle Up Modal State
    settleModalOpen: false,
    settleFriendId: null,
    settleAmount: '',
    settleDirection: 'friend_paid_me', // 'friend_paid_me' | 'i_paid_friend'
    settleAccountId: 'upi',
    settleDate: getTodayISO(),
    settleNote: '',
    settleError: '',

    // Friend Forgive Debt Modal State
    forgiveModalOpen: false,
    forgiveFriendId: null,
    forgiveAmount: '',
    forgiveDate: getTodayISO(),
    forgiveError: '',

    // Backup / Restore JSON Textarea Drawer
    jsonDrawerMode: null, // 'export' | 'import' | null
    jsonTextBuffer: '',

    // PWA Install Prompt State
    deferredInstallPrompt: null,
    isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    isIOS: /iphone|ipad|ipod/i.test(window.navigator.userAgent),
    showIOSInstallModal: false
  };

  function showToast(message) {
    ui.toastMessage = message;
    const toastEl = document.getElementById('toast-banner');
    if (toastEl) {
      toastEl.textContent = message;
      toastEl.classList.remove('hidden', 'opacity-0', 'translate-y-2');
      toastEl.classList.add('opacity-100', 'translate-y-0');
    }
    if (ui.toastTimer) clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.classList.add('hidden');
      }
      ui.toastMessage = null;
    }, 2600);
  }

  function escapeHTML(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons();
      } catch (_err) {
        // Ignore icon render errors
      }
    }
  }

  function persistAndRender(toastMsg) {
    appState = storage.saveSync(appState);
    renderApp();
    if (toastMsg) showToast(toastMsg);
  }

  // ==========================================================================
  // MODAL INITIALIZERS (New / Edit / Quick Transfer)
  // ==========================================================================

  function resetModalStateForNew(defaultTab = 'expense', transferPreset = 'upi_to_lite') {
    const today = getTodayISO();
    ui.editingTxId = null;
    ui.modalTab = defaultTab;

    // Expense defaults
    ui.expAmount = '';
    ui.expDate = today;
    ui.expCategoryId = 'food';
    ui.expPayer = 'me';
    ui.expAccountId = 'upi';
    ui.expIsSplit = false;
    ui.expSplitMode = 'equal';
    ui.expEqualIncludeMe = true;
    ui.expSelectedFriends = {};
    appState.friends.forEach((f, idx) => {
      ui.expSelectedFriends[f.id] = idx < 2; // Pre-select first 2 friends when split is toggled on
    });
    ui.expMyBaseItem = '';
    ui.expFriendBaseItems = {};
    ui.expTaxOrExtra = '';
    ui.expMyManualShare = '';
    ui.expFriendManualShares = {};
    ui.expNote = '';
    ui.expError = '';

    // Transfer defaults
    ui.trfPreset = transferPreset;
    if (transferPreset === 'upi_to_cash') {
      ui.trfFromAccount = 'upi';
      ui.trfToAccount = 'cash';
    } else {
      ui.trfFromAccount = 'upi';
      ui.trfToAccount = 'upi_lite';
    }
    ui.trfAmount = '';
    ui.trfDate = today;
    ui.trfNote = '';
    ui.trfError = '';

    // Income defaults
    ui.incAccount = 'upi';
    ui.incAmount = '';
    ui.incDate = today;
    ui.incNote = '';
    ui.incError = '';
  }

  function openAddModal(tab = 'expense', transferPreset = 'upi_to_lite') {
    resetModalStateForNew(tab, transferPreset);
    ui.modalOpen = true;
    renderModal();
  }

  function openEditModal(txId) {
    const tx = appState.transactions.find((t) => t.id === txId);
    if (!tx) return;

    resetModalStateForNew('expense');
    ui.editingTxId = tx.id;

    if (tx.type === 'expense' || tx.type === 'forgive') {
      ui.modalTab = 'expense';
      ui.expAmount = String(tx.amount);
      ui.expDate = tx.date || getTodayISO();
      ui.expCategoryId = tx.categoryId || 'miscellaneous';
      ui.expPayer = tx.payer || 'me';
      ui.expAccountId = tx.accountId || 'upi';
      ui.expIsSplit = Boolean(tx.isSplit);
      ui.expSplitMode = tx.splitMode && tx.splitMode !== 'none' ? tx.splitMode : 'equal';
      ui.expNote = tx.note || '';

      ui.expSelectedFriends = {};
      ui.expFriendBaseItems = {};
      ui.expFriendManualShares = {};

      if (tx.isSplit && Array.isArray(tx.friendShares) && tx.friendShares.length > 0) {
        tx.friendShares.forEach((fs) => {
          ui.expSelectedFriends[fs.friendId] = true;
          ui.expFriendBaseItems[fs.friendId] = String(fs.baseItem ?? fs.amount ?? '');
          ui.expFriendManualShares[fs.friendId] = String(fs.amount ?? '');
        });
        ui.expMyBaseItem = String(tx.myBaseItem ?? tx.myShare ?? '');
        ui.expTaxOrExtra = String(tx.taxOrExtra ?? 0);
        ui.expMyManualShare = String(tx.myShare ?? '');
        ui.expEqualIncludeMe = roundCurrency(tx.myShare) > 0;
      } else if (tx.payer !== 'me') {
        ui.expIsSplit = true;
        ui.expSplitMode = 'manual';
        ui.expMyManualShare = String(tx.myShare ?? tx.amount);
      }
    } else if (tx.type === 'transfer') {
      ui.modalTab = 'transfer';
      ui.trfFromAccount = tx.fromAccountId || 'upi';
      ui.trfToAccount = tx.toAccountId || 'upi_lite';
      if (ui.trfFromAccount === 'upi' && ui.trfToAccount === 'upi_lite') {
        ui.trfPreset = 'upi_to_lite';
      } else if (ui.trfFromAccount === 'upi' && ui.trfToAccount === 'cash') {
        ui.trfPreset = 'upi_to_cash';
      } else {
        ui.trfPreset = 'custom';
      }
      ui.trfAmount = String(tx.amount);
      ui.trfDate = tx.date || getTodayISO();
      ui.trfNote = tx.note || '';
    } else if (tx.type === 'income') {
      ui.modalTab = 'income';
      ui.incAccount = tx.accountId || 'upi';
      ui.incAmount = String(tx.amount);
      ui.incDate = tx.date || getTodayISO();
      ui.incNote = tx.note || '';
    } else if (tx.type === 'settlement') {
      // Open the Settle Up modal in edit mode
      ui.settleFriendId = tx.friendId;
      ui.editingTxId = tx.id;
      ui.settleAmount = String(tx.amount);
      ui.settleDirection = tx.direction || 'friend_paid_me';
      ui.settleAccountId = tx.accountId || 'upi';
      ui.settleDate = tx.date || getTodayISO();
      ui.settleNote = tx.note || '';
      ui.settleError = '';
      ui.settleModalOpen = true;
      renderSettleModal();
      return;
    }

    ui.modalOpen = true;
    renderModal();
  }

  function closeMainModal() {
    ui.modalOpen = false;
    ui.editingTxId = null;
    renderModal();
  }

  // ==========================================================================
  // LIVE SPLIT CALCULATION PREVIEW HELPER
  // ==========================================================================

  function getActiveExpenseSplitResult() {
    const total = roundCurrency(ui.expAmount);
    const selectedFriendIds = appState.friends
      .map((f) => f.id)
      .filter((fid) => ui.expSelectedFriends[fid]);

    // If Friend Paid and user didn't toggle split or select friends, treat as shared bill paid by friend
    if (ui.expPayer !== 'me' && !ui.expIsSplit) {
      return {
        isValid: total > 0,
        totalAmount: total,
        myShare: total,
        friendShares: [],
        summaryText: `Friend paid ${formatINR(total)} • Your Share: ${formatINR(total)}`
      };
    }

    if (!ui.expIsSplit) {
      return {
        isValid: total > 0,
        totalAmount: total,
        myShare: total,
        friendShares: [],
        summaryText: `100% Personal Expense (${formatINR(total)})`
      };
    }

    if (ui.expSplitMode === 'equal') {
      const res = computeEqualSplit(total, selectedFriendIds, ui.expEqualIncludeMe);
      const splitOut = roundCurrency(res.totalAmount - res.myShare);
      return {
        ...res,
        summaryText: res.isValid
          ? `Your Share: ${formatINR(res.myShare)} • Friends' Share: ${formatINR(splitOut)}`
          : 'Select at least 1 friend and enter bill amount'
      };
    }

    if (ui.expSplitMode === 'itemized') {
      const friendItems = selectedFriendIds.map((fid) => ({
        friendId: fid,
        baseItem: roundCurrency(ui.expFriendBaseItems[fid] || 0)
      }));
      const res = computeItemizedSplit(ui.expMyBaseItem, friendItems, ui.expTaxOrExtra);
      const splitOut = roundCurrency(res.totalAmount - res.myShare);
      return {
        ...res,
        summaryText: res.isValid
          ? `Total Bill: ${formatINR(res.totalAmount)} • Your Share: ${formatINR(res.myShare)} • Split: ${formatINR(splitOut)}`
          : 'Enter item amounts for yourself and at least 1 friend'
      };
    }

    // Manual mode
    const friendManual = selectedFriendIds.map((fid) => ({
      friendId: fid,
      amount: roundCurrency(ui.expFriendManualShares[fid] || 0)
    }));
    const res = computeManualSplit(total, ui.expMyManualShare, friendManual);
    return {
      ...res,
      summaryText: res.isValid
        ? `Matched ${formatINR(res.totalAmount)} • Your Share: ${formatINR(res.myShare)} • Split: ${formatINR(res.friendsSum)}`
        : `Unallocated difference: ${formatINR(res.difference)} (Shares must sum to ${formatINR(total)})`
    };
  }

  // ==========================================================================
  // FORM SUBMISSION HANDLERS
  // ==========================================================================

  function handleSaveTransaction() {
    if (ui.modalTab === 'expense') {
      const splitRes = getActiveExpenseSplitResult();
      const totalAmount = ui.expIsSplit && ui.expSplitMode === 'itemized'
        ? splitRes.totalAmount
        : roundCurrency(ui.expAmount);

      if (totalAmount <= 0) {
        ui.expError = 'Please enter a valid rupee amount greater than ₹0.';
        renderModal();
        return;
      }

      if (ui.expIsSplit && !splitRes.isValid) {
        ui.expError = splitRes.summaryText || 'Please complete the split bill breakdown.';
        renderModal();
        return;
      }

      const catObj = appState.categories.find((c) => c.id === ui.expCategoryId) || DEFAULT_CATEGORIES[0];
      const defaultNote = catObj ? catObj.name : 'Expense';
      const txPayload = {
        id: ui.editingTxId || `tx_exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'expense',
        date: ui.expDate || getTodayISO(),
        createdAt: ui.editingTxId
          ? (appState.transactions.find((t) => t.id === ui.editingTxId)?.createdAt || Date.now())
          : Date.now(),
        amount: totalAmount,
        myShare: roundCurrency(splitRes.myShare),
        categoryId: ui.expCategoryId,
        payer: ui.expPayer || 'me',
        accountId: (ui.expPayer || 'me') === 'me' ? ui.expAccountId : null,
        isSplit: Boolean(ui.expIsSplit || ui.expPayer !== 'me'),
        splitMode: ui.expIsSplit ? ui.expSplitMode : 'none',
        friendShares: ui.expIsSplit ? splitRes.friendShares : [],
        myBaseItem: ui.expSplitMode === 'itemized' ? roundCurrency(ui.expMyBaseItem) : undefined,
        taxOrExtra: ui.expSplitMode === 'itemized' ? roundCurrency(ui.expTaxOrExtra) : undefined,
        note: (ui.expNote || '').trim() || defaultNote
      };

      if (ui.editingTxId) {
        appState.transactions = appState.transactions.map((t) => (t.id === ui.editingTxId ? txPayload : t));
      } else {
        appState.transactions.push(txPayload);
      }

      ui.modalOpen = false;
      ui.editingTxId = null;
      persistAndRender(ui.editingTxId ? 'Expense updated & ledger reconciled' : 'Expense saved');
      return;
    }

    if (ui.modalTab === 'transfer') {
      const amount = roundCurrency(ui.trfAmount);
      if (amount <= 0) {
        ui.trfError = 'Please enter a valid transfer amount greater than ₹0.';
        renderModal();
        return;
      }
      if (ui.trfFromAccount === ui.trfToAccount) {
        ui.trfError = 'Source and destination accounts must be different.';
        renderModal();
        return;
      }

      const fromName = ACCOUNTS.find((a) => a.id === ui.trfFromAccount)?.name || 'UPI';
      const toName = ACCOUNTS.find((a) => a.id === ui.trfToAccount)?.name || 'UPI Lite';
      const txPayload = {
        id: ui.editingTxId || `tx_trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'transfer',
        date: ui.trfDate || getTodayISO(),
        createdAt: ui.editingTxId
          ? (appState.transactions.find((t) => t.id === ui.editingTxId)?.createdAt || Date.now())
          : Date.now(),
        amount,
        myShare: 0,
        fromAccountId: ui.trfFromAccount,
        toAccountId: ui.trfToAccount,
        note: (ui.trfNote || '').trim() || `${fromName} → ${toName} Transfer`
      };

      if (ui.editingTxId) {
        appState.transactions = appState.transactions.map((t) => (t.id === ui.editingTxId ? txPayload : t));
      } else {
        appState.transactions.push(txPayload);
      }

      ui.modalOpen = false;
      ui.editingTxId = null;
      persistAndRender('1-Tap Transfer completed (₹0 budget impact)');
      return;
    }

    if (ui.modalTab === 'income') {
      const amount = roundCurrency(ui.incAmount);
      if (amount <= 0) {
        ui.incError = 'Please enter an amount greater than ₹0.';
        renderModal();
        return;
      }

      const accName = ACCOUNTS.find((a) => a.id === ui.incAccount)?.name || 'UPI';
      const txPayload = {
        id: ui.editingTxId || `tx_inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'income',
        date: ui.incDate || getTodayISO(),
        createdAt: ui.editingTxId
          ? (appState.transactions.find((t) => t.id === ui.editingTxId)?.createdAt || Date.now())
          : Date.now(),
        amount,
        myShare: 0,
        accountId: ui.incAccount,
        note: (ui.incNote || '').trim() || `Added Balance to ${accName}`
      };

      if (ui.editingTxId) {
        appState.transactions = appState.transactions.map((t) => (t.id === ui.editingTxId ? txPayload : t));
      } else {
        appState.transactions.push(txPayload);
      }

      ui.modalOpen = false;
      ui.editingTxId = null;
      persistAndRender(`Added ${formatINR(amount)} to ${accName}`);
    }
  }

  // ==========================================================================
  // SETTLE UP & FORGIVE DEBT HANDLERS
  // ==========================================================================

  function openSettleUpModal(friendId) {
    const ledger = calculateLedgerState(appState);
    const netBal = roundCurrency(ledger.friendBalances[friendId] || 0);
    ui.editingTxId = null;
    ui.settleFriendId = friendId;
    ui.settleAmount = netBal !== 0 ? String(Math.abs(netBal)) : '';
    ui.settleDirection = netBal >= 0 ? 'friend_paid_me' : 'i_paid_friend';
    ui.settleAccountId = 'upi';
    ui.settleDate = getTodayISO();
    ui.settleNote = '';
    ui.settleError = '';
    ui.settleModalOpen = true;
    renderSettleModal();
  }

  function handleConfirmSettleUp() {
    const amount = roundCurrency(ui.settleAmount);
    if (amount <= 0) {
      ui.settleError = 'Enter a settlement amount greater than ₹0.';
      renderSettleModal();
      return;
    }

    const friend = appState.friends.find((f) => f.id === ui.settleFriendId);
    const friendName = friend ? friend.name : 'Friend';
    const defaultNote = ui.settleDirection === 'friend_paid_me'
      ? `Settlement from ${friendName}`
      : `Settlement paid to ${friendName}`;

    const txPayload = {
      id: ui.editingTxId || `tx_stl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'settlement',
      date: ui.settleDate || getTodayISO(),
      createdAt: ui.editingTxId
        ? (appState.transactions.find((t) => t.id === ui.editingTxId)?.createdAt || Date.now())
        : Date.now(),
      amount,
      myShare: 0,
      friendId: ui.settleFriendId,
      direction: ui.settleDirection,
      accountId: ui.settleAccountId,
      note: (ui.settleNote || '').trim() || defaultNote
    };

    if (ui.editingTxId) {
      appState.transactions = appState.transactions.map((t) => (t.id === ui.editingTxId ? txPayload : t));
    } else {
      appState.transactions.push(txPayload);
    }

    ui.settleModalOpen = false;
    ui.editingTxId = null;
    renderSettleModal();
    persistAndRender(`Settled ${formatINR(amount)} with ${friendName}`);
  }

  function openForgiveModal(friendId) {
    const ledger = calculateLedgerState(appState);
    const netBal = roundCurrency(ledger.friendBalances[friendId] || 0);
    if (netBal <= 0) return;

    ui.forgiveFriendId = friendId;
    ui.forgiveAmount = String(netBal);
    ui.forgiveDate = getTodayISO();
    ui.forgiveError = '';
    ui.forgiveModalOpen = true;
    renderForgiveModal();
  }

  function handleConfirmForgive() {
    const ledger = calculateLedgerState(appState);
    const maxForgivable = roundCurrency(ledger.friendBalances[ui.forgiveFriendId] || 0);
    const amount = roundCurrency(ui.forgiveAmount);

    if (amount <= 0) {
      ui.forgiveError = 'Enter an amount greater than ₹0 to forgive.';
      renderForgiveModal();
      return;
    }
    if (amount > maxForgivable) {
      ui.forgiveError = `Cannot forgive more than current owed balance (${formatINR(maxForgivable)}).`;
      renderForgiveModal();
      return;
    }

    const friend = appState.friends.find((f) => f.id === ui.forgiveFriendId);
    const friendName = friend ? friend.name : 'Friend';

    const forgiveTx = createForgiveTransaction({
      friendId: ui.forgiveFriendId,
      friendName,
      amount,
      dateISO: ui.forgiveDate || getTodayISO()
    });

    appState.transactions.push(forgiveTx);
    ui.forgiveModalOpen = false;
    renderForgiveModal();
    persistAndRender(`Forgave ${formatINR(amount)} for ${friendName} (logged under Miscellaneous)`);
  }

  // ==========================================================================
  // RENDER FUNCTIONS FOR ALL 4 TABS & MODALS
  // ==========================================================================

  function renderApp() {
    const todayISO = getTodayISO();
    const ledger = calculateLedgerState(appState, todayISO);

    const friendsMap = {};
    appState.friends.forEach((f) => {
      friendsMap[f.id] = f.name;
    });
    const accountsMap = {
      upi: 'UPI',
      upi_lite: 'UPI Lite',
      cash: 'Physical Cash'
    };
    const categoriesMap = {};
    appState.categories.forEach((c) => {
      categoriesMap[c.id] = c;
    });

    // Update bottom nav active state
    document.querySelectorAll('[data-nav-tab]').forEach((btn) => {
      const tab = btn.getAttribute('data-nav-tab');
      const isActive = tab === ui.activeTab;
      btn.className = `flex flex-col items-center justify-center min-h-[48px] px-2 transition-colors ${
        isActive ? 'text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
      }`;
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    // Update Install App button visibility in Header
    const installBtn = document.getElementById('header-install-btn');
    if (installBtn) {
      if (!ui.isStandalone && (ui.deferredInstallPrompt || ui.isIOS)) {
        installBtn.classList.remove('hidden');
      } else {
        installBtn.classList.add('hidden');
      }
    }

    const mainContainer = document.getElementById('app-view-container');
    if (!mainContainer) return;

    if (ui.activeTab === 'home') {
      mainContainer.innerHTML = renderHomeView(ledger, friendsMap, accountsMap, categoriesMap, todayISO);
    } else if (ui.activeTab === 'friends') {
      mainContainer.innerHTML = renderFriendsView(ledger);
    } else if (ui.activeTab === 'analytics') {
      mainContainer.innerHTML = renderAnalyticsView(ledger);
    } else if (ui.activeTab === 'settings') {
      mainContainer.innerHTML = renderSettingsView(ledger);
    }

    renderModal();
    renderSettleModal();
    renderForgiveModal();
    refreshIcons();
  }

  function renderHomeView(ledger, friendsMap, accountsMap, categoriesMap, todayISO) {
    const {
      accountBalances,
      todaySpend,
      currentMonthSpend,
      monthlyBudget,
      budgetRemaining,
      budgetUtilizationPct,
      isOverBudget,
      lastMonthVariance,
      newestFirstTransactions
    } = ledger;

    // Filter transactions for Master Transaction Feed
    const query = ui.searchQuery.trim().toLowerCase();
    const filteredTxs = newestFirstTransactions.filter((tx) => {
      if (ui.txFilter === 'expense' && tx.type !== 'expense' && tx.type !== 'forgive') return false;
      if (ui.txFilter === 'split' && !tx.isSplit && tx.type !== 'forgive' && tx.payer === 'me') return false;
      if (ui.txFilter === 'transfer' && tx.type !== 'transfer' && tx.type !== 'income') return false;
      if (ui.txFilter === 'settlement' && tx.type !== 'settlement') return false;

      if (!query) return true;
      const catName = (categoriesMap[tx.categoryId]?.name || '').toLowerCase();
      const note = (tx.note || '').toLowerCase();
      const badge = getTransactionBadgeText(tx, friendsMap, accountsMap).toLowerCase();
      return note.includes(query) || catName.includes(query) || badge.includes(query) || tx.date.includes(query);
    });

    const txRowsHTML = filteredTxs.length === 0
      ? `
        <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-8 text-center">
          <div class="w-11 h-11 rounded-full bg-zinc-800/80 flex items-center justify-center mx-auto mb-3 text-zinc-400">
            <i data-lucide="receipt" class="w-5 h-5"></i>
          </div>
          <p class="text-sm font-medium text-zinc-200">No transactions match your filter</p>
          <p class="text-xs text-zinc-400 mt-1">Tap the center + button below to log an expense, split, or transfer.</p>
        </div>
      `
      : filteredTxs.map((tx) => renderTransactionRow(tx, friendsMap, accountsMap, categoriesMap)).join('');

    const varianceColorClass = lastMonthVariance.isUnderBudget
      ? 'text-[#10B981] border-emerald-500/30 bg-emerald-500/10'
      : 'text-[#F43F5E] border-rose-500/30 bg-rose-500/10';

    return `
      <div class="space-y-4 pb-6">
        <!-- Top Live Account Balances Bar (3 Accounts + 1-Tap Transfer) -->
        <section aria-label="Live Account Balances" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
          <div class="flex items-center justify-between mb-2.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-zinc-400">Live Account Balances</span>
              <span class="text-zinc-600" aria-hidden="true">·</span>
              <span class="text-xs font-mono tabular-nums text-zinc-300 font-semibold">${formatINR(accountBalances.total)}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                data-action="quick-add-balance"
                class="min-h-[36px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition-colors"
                aria-label="Add external balance or income"
              >
                <i data-lucide="plus-circle" class="w-3.5 h-3.5 text-emerald-400"></i>
                <span>+ Income</span>
              </button>
              <button
                type="button"
                data-action="quick-transfer"
                class="min-h-[36px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-1 transition-colors"
                aria-label="1-Tap Internal Transfer"
              >
                <i data-lucide="arrow-left-right" class="w-3.5 h-3.5"></i>
                <span>Transfer</span>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <div class="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>UPI</span>
                <i data-lucide="landmark" class="w-3.5 h-3.5 text-zinc-500"></i>
              </div>
              <p data-testid="balance-upi" class="text-sm font-mono tabular-nums font-bold mt-1 ${
                accountBalances.upi >= 0 ? 'text-[#FAFAFA]' : 'text-[#F43F5E]'
              }">${formatINR(accountBalances.upi)}</p>
              <p class="text-[10px] text-zinc-500 mt-0.5 truncate">Primary Bank</p>
            </div>

            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <div class="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>UPI Lite</span>
                <i data-lucide="smartphone" class="w-3.5 h-3.5 text-zinc-500"></i>
              </div>
              <p data-testid="balance-upi-lite" class="text-sm font-mono tabular-nums font-bold mt-1 ${
                accountBalances.upi_lite >= 0 ? 'text-[#FAFAFA]' : 'text-[#F43F5E]'
              }">${formatINR(accountBalances.upi_lite)}</p>
              <p class="text-[10px] text-zinc-500 mt-0.5 truncate">Wallet Pinless</p>
            </div>

            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <div class="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>Cash</span>
                <i data-lucide="banknote" class="w-3.5 h-3.5 text-zinc-500"></i>
              </div>
              <p data-testid="balance-cash" class="text-sm font-mono tabular-nums font-bold mt-1 ${
                accountBalances.cash >= 0 ? 'text-[#FAFAFA]' : 'text-[#F43F5E]'
              }">${formatINR(accountBalances.cash)}</p>
              <p class="text-[10px] text-zinc-500 mt-0.5 truncate">Physical Notes</p>
            </div>
          </div>
        </section>

        <!-- Hero Spend Card -->
        <section aria-label="Today's Spend and Monthly Budget" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4">
          <div class="flex items-baseline justify-between">
            <div>
              <p class="text-xs font-medium text-zinc-400">Today's Personal Spend (${todayISO})</p>
              <h1 data-testid="today-spend-metric" class="text-3xl font-mono tabular-nums font-bold tracking-tight text-[#FAFAFA] mt-1">
                Today's Spend: ${formatINR(todaySpend)}
              </h1>
            </div>
          </div>

          <!-- Monthly Budget Progress Bar -->
          <div class="mt-4 pt-3.5 border-t border-[#27272A]">
            <div class="flex items-center justify-between text-xs mb-1.5">
              <span class="text-zinc-300 font-medium">
                ${formatMonthYear(ledger.currentMonthISO)} Budget:
                <span data-testid="monthly-spend-summary" class="font-mono tabular-nums font-semibold text-[#FAFAFA]">${formatINR(currentMonthSpend)}</span>
                <span class="text-zinc-500">/</span>
                <span class="font-mono tabular-nums text-zinc-400">${formatINR(monthlyBudget)}</span>
              </span>
              <span data-testid="monthly-budget-remaining" class="font-mono tabular-nums font-semibold ${
                isOverBudget ? 'text-[#F43F5E]' : 'text-[#10B981]'
              }">
                ${isOverBudget
                  ? `${formatINR(Math.abs(budgetRemaining))} Over`
                  : `${formatINR(budgetRemaining)} left`}
              </span>
            </div>

            <div class="w-full h-2.5 bg-[#09090B] rounded-full overflow-hidden border border-[#27272A]">
              <div
                class="h-full transition-all duration-200 ${isOverBudget ? 'bg-[#F43F5E]' : 'bg-[#10B981]'}"
                style="width: ${budgetUtilizationPct}%"
              ></div>
            </div>

            <!-- Persistent Last Month Variance Reference Badge -->
            <div class="mt-3 flex items-center justify-between gap-2">
              <div
                data-testid="last-month-variance-badge"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium font-mono tabular-nums ${varianceColorClass}"
              >
                <i data-lucide="${lastMonthVariance.isUnderBudget ? 'trending-down' : 'trending-up'}" class="w-3.5 h-3.5"></i>
                <span>${escapeHTML(lastMonthVariance.badgeText)}</span>
              </div>
              <span class="text-[11px] text-zinc-500">No rollover</span>
            </div>
          </div>
        </section>

        <!-- Master Transaction Feed Controls -->
        <section aria-label="Master Transaction History" class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-[#FAFAFA]">Master Transaction Ledger</h2>
            <span class="text-xs font-mono tabular-nums text-zinc-400">${filteredTxs.length} entries</span>
          </div>

          <!-- Search + Segmented Filter -->
          <div class="space-y-2">
            <div class="relative">
              <i data-lucide="search" class="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"></i>
              <input
                type="search"
                id="tx-search-input"
                value="${escapeHTML(ui.searchQuery)}"
                placeholder="Search note, category, date, or friend..."
                aria-label="Search transactions"
                class="w-full h-11 pl-10 pr-4 bg-[#18181B] border border-[#27272A] rounded-xl text-sm text-[#FAFAFA] placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div class="flex items-center gap-1 p-1 bg-[#18181B] border border-[#27272A] rounded-xl overflow-x-auto">
              ${[
                { id: 'all', label: 'All' },
                { id: 'expense', label: 'Expenses' },
                { id: 'split', label: 'Splits' },
                { id: 'transfer', label: 'Transfers' },
                { id: 'settlement', label: 'Settles' }
              ]
                .map(
                  (tab) => `
                  <button
                    type="button"
                    data-tx-filter="${tab.id}"
                    class="flex-1 min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      ui.txFilter === tab.id
                        ? 'bg-zinc-800 text-[#FAFAFA] shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }"
                  >
                    ${tab.label}
                  </button>
                `
                )
                .join('')}
            </div>
          </div>

          <!-- Continuous Unbroken Transaction List -->
          <div data-testid="master-transaction-list" class="space-y-2">
            ${txRowsHTML}
          </div>
        </section>
      </div>
    `;
  }

  function renderTransactionRow(tx, friendsMap, accountsMap, categoriesMap) {
    const badgeText = getTransactionBadgeText(tx, friendsMap, accountsMap);
    let iconName = 'receipt';
    let categoryLabel = 'Expense';
    let amountDisplay = '';
    let amountColor = 'text-[#F43F5E]';

    if (tx.type === 'expense') {
      const cat = categoriesMap[tx.categoryId] || { name: 'Miscellaneous', icon: 'layers' };
      iconName = cat.icon || 'layers';
      categoryLabel = cat.name;
      const myShare = roundCurrency(tx.myShare !== undefined ? tx.myShare : tx.amount);
      amountDisplay = `-${formatINR(myShare)}`;
      amountColor = 'text-[#F43F5E]';
    } else if (tx.type === 'forgive') {
      iconName = 'heart-handshake';
      categoryLabel = 'Miscellaneous (Forgiven)';
      amountDisplay = `-${formatINR(tx.myShare || tx.amount)}`;
      amountColor = 'text-[#F43F5E]';
    } else if (tx.type === 'transfer') {
      iconName = 'arrow-left-right';
      categoryLabel = 'Internal Transfer';
      amountDisplay = formatINR(tx.amount);
      amountColor = 'text-zinc-300';
    } else if (tx.type === 'income') {
      iconName = 'arrow-down-left';
      categoryLabel = 'Add Balance / Income';
      amountDisplay = `+${formatINR(tx.amount)}`;
      amountColor = 'text-[#10B981]';
    } else if (tx.type === 'settlement') {
      iconName = 'check-circle-2';
      categoryLabel = 'Friend Settlement';
      amountDisplay = tx.direction === 'friend_paid_me'
        ? `+${formatINR(tx.amount)}`
        : `-${formatINR(tx.amount)}`;
      amountColor = tx.direction === 'friend_paid_me' ? 'text-[#10B981]' : 'text-zinc-200';
    }

    const isConfirmingDelete = ui.confirmDeleteTxId === tx.id;
    const noteLabel = tx.note || categoryLabel;

    return `
      <article
        data-testid="tx-row-${tx.id}"
        class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5 transition-colors hover:border-zinc-700"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl bg-[#09090B] border border-[#27272A] flex items-center justify-center shrink-0 text-zinc-300 mt-0.5">
              <i data-lucide="${escapeHTML(iconName)}" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-[#FAFAFA] truncate">${escapeHTML(noteLabel)}</p>
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
                <span>${escapeHTML(categoryLabel)}</span>
                <span aria-hidden="true">·</span>
                <span class="font-mono tabular-nums">${escapeHTML(tx.date)}</span>
              </div>
              <p class="text-xs text-zinc-300 mt-1.5 font-mono tabular-nums leading-relaxed">
                ${escapeHTML(badgeText)}
              </p>
            </div>
          </div>

          <div class="text-right shrink-0">
            <p class="text-sm font-mono tabular-nums font-bold ${amountColor}">
              ${amountDisplay}
            </p>
            ${
              tx.type === 'expense' && tx.isSplit && tx.payer === 'me'
                ? `<p class="text-[11px] font-mono tabular-nums text-zinc-500 mt-0.5">Bill ${formatINR(tx.amount)}</p>`
                : ''
            }
          </div>
        </div>

        <div class="mt-3 pt-2.5 border-t border-[#27272A]/80 flex items-center justify-end gap-2">
          ${
            isConfirmingDelete
              ? `
                <span class="text-xs text-rose-400 mr-auto">Delete entry & recalculate?</span>
                <button
                  type="button"
                  data-cancel-delete-tx="${tx.id}"
                  class="min-h-[36px] px-3 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-confirm-delete-tx="${tx.id}"
                  aria-label="Confirm delete transaction ${escapeHTML(noteLabel)}"
                  class="min-h-[36px] px-3 py-1 rounded-lg bg-[#F43F5E] text-white text-xs font-semibold"
                >
                  Confirm Delete
                </button>
              `
              : `
                <button
                  type="button"
                  data-edit-tx="${tx.id}"
                  aria-label="Edit transaction ${escapeHTML(noteLabel)}"
                  class="min-h-[36px] px-3 py-1 rounded-lg bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  data-delete-tx="${tx.id}"
                  aria-label="Delete transaction ${escapeHTML(noteLabel)}"
                  class="min-h-[36px] px-3 py-1 rounded-lg bg-[#09090B] hover:bg-rose-950/50 border border-[#27272A] hover:border-rose-500/40 text-rose-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  <span>Delete</span>
                </button>
              `
          }
        </div>
      </article>
    `;
  }

  // ==========================================================================
  // TAB 2: FRIENDS VIEW (Offline Splitwise Engine)
  // ==========================================================================

  function renderFriendsView(ledger) {
    const { friendBalances, friendHistories, friendSummary } = ledger;

    const friendCardsHTML = appState.friends.length === 0
      ? `
        <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-8 text-center">
          <p class="text-sm font-medium text-zinc-200">No friends added yet</p>
          <p class="text-xs text-zinc-400 mt-1">Add a friend above to start splitting bills offline.</p>
        </div>
      `
      : appState.friends
          .map((friend) => {
            const bal = roundCurrency(friendBalances[friend.id] || 0);
            const history = friendHistories[friend.id] || [];
            const isExpanded = Boolean(ui.expandedFriendIds[friend.id]);

            let statusText = 'Settled up';
            let statusColor = 'text-zinc-400';
            if (bal > 0) {
              statusText = `Owes you ${formatINR(bal, true)}`;
              statusColor = 'text-[#10B981]';
            } else if (bal < 0) {
              statusText = `You owe ${formatINR(bal, true)}`;
              statusColor = 'text-[#F43F5E]';
            }

            const initials = friend.name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            return `
              <article
                data-testid="friend-card-${friend.id}"
                class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 rounded-full bg-[#09090B] border border-[#27272A] flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0">
                      ${escapeHTML(initials)}
                    </div>
                    <div class="min-w-0">
                      <h3 class="text-sm font-semibold text-[#FAFAFA] truncate">${escapeHTML(friend.name)}</h3>
                      <p data-testid="friend-balance-${friend.id}" class="text-xs font-mono tabular-nums font-semibold ${statusColor} mt-0.5">
                        ${statusText}
                      </p>
                    </div>
                  </div>

                  <div class="text-right shrink-0">
                    <span class="text-base font-mono tabular-nums font-bold ${statusColor}">
                      ${formatINR(bal, true)}
                    </span>
                  </div>
                </div>

                <!-- Friend Action Buttons: Settle Up, Forgive / Round Off, Ledger History -->
                <div class="flex items-center gap-1.5 pt-2.5 border-t border-[#27272A]">
                  <button
                    type="button"
                    data-settle-friend="${friend.id}"
                    aria-label="Settle up with ${escapeHTML(friend.name)}"
                    class="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <i data-lucide="hand-coins" class="w-3.5 h-3.5 shrink-0"></i>
                    <span>Settle Up</span>
                  </button>

                  ${
                    bal > 0
                      ? `
                        <button
                          type="button"
                          data-forgive-friend="${friend.id}"
                          aria-label="Forgive or round off debt for ${escapeHTML(friend.name)}"
                          class="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <i data-lucide="heart-handshake" class="w-3.5 h-3.5 text-amber-400 shrink-0"></i>
                          <span>Forgive</span>
                        </button>
                      `
                      : ''
                  }

                  <button
                    type="button"
                    data-toggle-friend-history="${friend.id}"
                    aria-expanded="${isExpanded ? 'true' : 'false'}"
                    class="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-zinc-300 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 ml-auto transition-colors"
                  >
                    <span>Ledger (${history.length})</span>
                    <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5 shrink-0"></i>
                  </button>
                </div>

                ${
                  isExpanded
                    ? `
                      <div class="pt-2 border-t border-[#27272A] space-y-2">
                        <p class="text-[11px] font-medium text-zinc-400">Per-Friend Mutual Netting Ledger</p>
                        ${
                          history.length === 0
                            ? `<p class="text-xs text-zinc-500 py-2">No shared splits or settlements recorded yet.</p>`
                            : history
                                .map(
                                  (item) => `
                                  <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
                                    <div class="min-w-0">
                                      <p class="font-medium text-zinc-200 truncate">${escapeHTML(item.note)}</p>
                                      <p class="text-[11px] text-zinc-500 font-mono tabular-nums mt-0.5">
                                        ${escapeHTML(item.date)} · Bill ${formatINR(item.totalBill)}
                                      </p>
                                    </div>
                                    <div class="text-right shrink-0 font-mono tabular-nums">
                                      <p class="font-semibold ${item.delta >= 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'}">
                                        ${formatINR(item.delta, true)}
                                      </p>
                                      <p class="text-[10px] text-zinc-500">Net: ${formatINR(item.runningBalance, true)}</p>
                                    </div>
                                  </div>
                                `
                                )
                                .join('')
                        }
                      </div>
                    `
                    : ''
                }
              </article>
            `;
          })
          .join('');

    return `
      <div class="space-y-4 pb-6">
        <!-- Top Peer-to-Peer Netting Summary -->
        <section aria-label="Friends Splitwise Summary" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4">
          <h1 class="text-base font-semibold text-[#FAFAFA] mb-3">Peer-to-Peer Splitwise Balances</h1>
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <p class="text-[11px] text-zinc-400">Owed to You</p>
              <p data-testid="friends-owed-to-you" class="text-sm font-mono tabular-nums font-bold text-[#10B981] mt-1">
                +${formatINR(friendSummary.totalOwedToYou)}
              </p>
            </div>
            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <p class="text-[11px] text-zinc-400">You Owe</p>
              <p data-testid="friends-you-owe" class="text-sm font-mono tabular-nums font-bold text-[#F43F5E] mt-1">
                -${formatINR(friendSummary.totalYouOwe)}
              </p>
            </div>
            <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5">
              <p class="text-[11px] text-zinc-400">Net Balance</p>
              <p data-testid="friends-net-balance" class="text-sm font-mono tabular-nums font-bold mt-1 ${
                friendSummary.netBalance >= 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'
              }">
                ${formatINR(friendSummary.netBalance, true)}
              </p>
            </div>
          </div>
        </section>

        <!-- Add Friend Input -->
        <section aria-label="Add Friend" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
          <form id="add-friend-form" class="flex items-center gap-2">
            <input
              type="text"
              id="new-friend-name-input"
              placeholder="Add friend name (e.g. Kabir Mehta)..."
              aria-label="New friend name"
              class="flex-1 h-11 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-sm text-[#FAFAFA] placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              class="min-h-[44px] px-4 rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-semibold text-xs whitespace-nowrap transition-colors"
            >
              Add Friend
            </button>
          </form>
        </section>

        <!-- Friend Cards List -->
        <section aria-label="Friends List" class="space-y-3">
          ${friendCardsHTML}
        </section>
      </div>
    `;
  }

  // ==========================================================================
  // TAB 3: ANALYTICS VIEW (Monthly Switcher, Fixed vs Variable, Category & Daily Charts)
  // ==========================================================================

  function renderAnalyticsView(ledger) {
    const analytics = calculateMonthAnalytics(appState, ui.analyticsMonthISO);
    const { lastMonthVariance } = ledger;

    const categoryBarsHTML = analytics.categoryChartBars
      .map(
        (bar) => `
        <div data-testid="category-bar-${bar.categoryId}" class="space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <i data-lucide="${escapeHTML(bar.icon)}" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span class="font-medium text-zinc-200">${escapeHTML(bar.name)}</span>
              <span class="text-zinc-500 font-mono tabular-nums">(${bar.pctOfVariable}%)</span>
            </div>
            <span class="font-mono tabular-nums font-semibold text-[#FAFAFA]">${formatINR(bar.spend)}</span>
          </div>
          <div class="w-full h-2.5 bg-[#09090B] border border-[#27272A] rounded-full overflow-hidden">
            <div
              class="h-full bg-[#10B981] rounded-full transition-all duration-200"
              style="width: ${bar.barWidthPct}%"
            ></div>
          </div>
        </div>
      `
      )
      .join('');

    const dailyBarsHTML = analytics.dailyChartBars
      .map(
        (d) => `
        <div class="flex flex-col items-center flex-1 min-w-[10px] group" title="${d.dateISO}: ${formatINR(d.spend)}">
          <div class="w-full h-28 bg-[#09090B] border border-[#27272A]/60 rounded-t-md flex items-end overflow-hidden p-[1px]">
            <div
              class="w-full rounded-t-sm transition-all ${d.spend > 0 ? 'bg-emerald-500 group-hover:bg-emerald-400' : 'bg-transparent'}"
              style="height: ${d.barHeightPct}%"
            ></div>
          </div>
          <span class="text-[9px] font-mono tabular-nums text-zinc-500 mt-1 ${
            d.day === 1 || d.day % 5 === 0 || d.day === analytics.dailyChartBars.length ? 'opacity-100' : 'opacity-40'
          }">${d.day}</span>
        </div>
      `
      )
      .join('');

    return `
      <div class="space-y-4 pb-6">
        <!-- Month Switcher Header -->
        <section aria-label="Analytics Month Selector" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5 flex items-center justify-between">
          <button
            type="button"
            data-analytics-month-nav="prev"
            aria-label="Previous Month"
            class="min-h-[40px] min-w-[40px] rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] flex items-center justify-center text-zinc-300"
          >
            <i data-lucide="chevron-left" class="w-4 h-4"></i>
          </button>

          <div class="text-center">
            <h1 data-testid="analytics-month-label" class="text-base font-bold text-[#FAFAFA] font-mono tabular-nums">
              ${escapeHTML(analytics.monthLabel)}
            </h1>
            <p class="text-[11px] text-zinc-400">Personal Consumption Breakdown</p>
          </div>

          <button
            type="button"
            data-analytics-month-nav="next"
            aria-label="Next Month"
            class="min-h-[40px] min-w-[40px] rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] flex items-center justify-center text-zinc-300"
          >
            <i data-lucide="chevron-right" class="w-4 h-4"></i>
          </button>
        </section>

        <!-- 4 Summary Cards -->
        <section aria-label="Monthly Spend Summary Cards" class="grid grid-cols-2 gap-2.5">
          <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
            <p class="text-xs text-zinc-400">Total Monthly Spend</p>
            <p data-testid="analytics-total-spend" class="text-lg font-mono tabular-nums font-bold text-[#FAFAFA] mt-1">
              ${formatINR(analytics.totalMonthlySpend)}
            </p>
            <p class="text-[11px] text-zinc-500 mt-0.5">All 10+ categories</p>
          </div>

          <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
            <p class="text-xs text-zinc-400">Fixed Overhead</p>
            <p data-testid="analytics-fixed-spend" class="text-lg font-mono tabular-nums font-bold text-zinc-200 mt-1">
              ${formatINR(analytics.fixedOverheadSpend)}
            </p>
            <p class="text-[11px] text-zinc-500 mt-0.5">Rent · Elec · Househelp</p>
          </div>

          <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
            <p class="text-xs text-zinc-400">Variable Spend</p>
            <p data-testid="analytics-variable-spend" class="text-lg font-mono tabular-nums font-bold text-[#10B981] mt-1">
              ${formatINR(analytics.variableSpend)}
            </p>
            <p class="text-[11px] text-zinc-500 mt-0.5">Displayed in bar chart</p>
          </div>

          <div class="bg-[#18181B] border border-[#27272A] rounded-2xl p-3.5">
            <p class="text-xs text-zinc-400">Last Month Variance</p>
            <p data-testid="analytics-last-month-variance" class="text-sm font-mono tabular-nums font-bold mt-1 ${
              lastMonthVariance.isUnderBudget ? 'text-[#10B981]' : 'text-[#F43F5E]'
            }">
              ${formatINR(lastMonthVariance.varianceAmount)} ${lastMonthVariance.isUnderBudget ? 'Under' : 'Over'}
            </p>
            <p class="text-[11px] text-zinc-500 mt-0.5">${escapeHTML(lastMonthVariance.monthLabel)} vs ${formatINR(lastMonthVariance.budget)}</p>
          </div>
        </section>

        <!-- Category Horizontal Bar Chart (Strictly Excluding Fixed Overhead Categories) -->
        <section aria-label="Variable Category Horizontal Bar Chart" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3.5">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-[#FAFAFA]">Variable Category Breakdown</h2>
              <p class="text-[11px] text-zinc-400 mt-0.5">
                Excludes fixed overhead (Rent, Electricity, Househelp)
              </p>
            </div>
            <span class="text-xs font-mono tabular-nums text-emerald-400 font-semibold">${formatINR(analytics.variableSpend)}</span>
          </div>

          <div data-testid="category-bar-chart" class="space-y-3 pt-1">
            ${categoryBarsHTML}
          </div>
        </section>

        <!-- Daily Spend Bar Chart (1 to 30/31) -->
        <section aria-label="Daily Spend Bar Chart" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-[#FAFAFA]">Daily Personal Spend (${escapeHTML(analytics.monthLabel)})</h2>
              <p class="text-[11px] text-zinc-400 mt-0.5">Day-by-day personal consumption (myShare)</p>
            </div>
            <span class="text-xs font-mono tabular-nums text-zinc-400">Peak: ${formatINR(analytics.maxDailySpend)}</span>
          </div>

          <div data-testid="daily-spend-chart" class="flex items-end gap-1 pt-2 overflow-x-auto pb-1">
            ${dailyBarsHTML}
          </div>
        </section>
      </div>
    `;
  }

  // ==========================================================================
  // TAB 4: SETTINGS VIEW (Budget, Starting Balances, Categories, JSON/CSV Backup)
  // ==========================================================================

  function renderSettingsView(ledger) {
    const categoriesHTML = appState.categories
      .map(
        (cat) => `
        <div class="bg-[#09090B] border border-[#27272A] rounded-xl p-2.5 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-[#18181B] border border-[#27272A] flex items-center justify-center text-zinc-300 shrink-0">
              <i data-lucide="${escapeHTML(cat.icon || 'tag')}" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-semibold text-[#FAFAFA] truncate">${escapeHTML(cat.name)}</p>
              <p class="text-[10px] text-zinc-400">
                ${cat.excludeFromBarChart ? 'Fixed Overhead (Hidden from Bar Chart)' : 'Variable (Shown in Bar Chart)'}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-toggle-cat-chart="${cat.id}"
              class="min-h-[34px] px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                cat.excludeFromBarChart
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              }"
            >
              ${cat.excludeFromBarChart ? 'Excluded' : 'In Chart'}
            </button>
            ${
              !cat.isSystem
                ? `
                  <button
                    type="button"
                    data-delete-cat="${cat.id}"
                    aria-label="Delete custom category ${escapeHTML(cat.name)}"
                    class="min-h-[34px] px-2 rounded-lg bg-zinc-900 hover:bg-rose-950/60 border border-[#27272A] text-rose-400 text-xs"
                  >
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                `
                : ''
            }
          </div>
        </div>
      `
      )
      .join('');

    return `
      <div class="space-y-4 pb-6">
        <!-- Monthly Budget Setting -->
        <section aria-label="Monthly Budget Target" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3">
          <div>
            <h2 class="text-sm font-semibold text-[#FAFAFA]">Monthly Budget Target (₹)</h2>
            <p class="text-xs text-zinc-400 mt-0.5">Resets cleanly on the 1st of each calendar month without rollover.</p>
          </div>

          <form id="settings-budget-form" class="flex items-center gap-2">
            <input
              type="number"
              step="100"
              min="0"
              id="settings-budget-input"
              value="${appState.monthlyBudget}"
              aria-label="Monthly Budget in Rupees"
              class="flex-1 h-11 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-sm font-mono tabular-nums text-[#FAFAFA] focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              class="min-h-[44px] px-4 rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-semibold text-xs whitespace-nowrap transition-colors"
            >
              Save Budget
            </button>
          </form>
        </section>

        <!-- Initial Starting Account Balances -->
        <section aria-label="Initial Starting Balances" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3">
          <div>
            <h2 class="text-sm font-semibold text-[#FAFAFA]">Starting Account Balances (₹)</h2>
            <p class="text-xs text-zinc-400 mt-0.5">Live balances dynamically reconcile from these starting baselines plus all ledger transactions.</p>
          </div>

          <form id="settings-balances-form" class="space-y-2.5">
            <div class="grid grid-cols-3 gap-2">
              <div>
                <label for="start-bal-upi" class="block text-[11px] text-zinc-400 mb-1">UPI (Bank)</label>
                <input
                  type="number"
                  step="any"
                  id="start-bal-upi"
                  value="${appState.startingBalances.upi}"
                  class="w-full h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono tabular-nums text-[#FAFAFA]"
                />
                <p class="text-[10px] text-zinc-500 font-mono tabular-nums mt-1">Live: ${formatINR(ledger.accountBalances.upi)}</p>
              </div>
              <div>
                <label for="start-bal-lite" class="block text-[11px] text-zinc-400 mb-1">UPI Lite</label>
                <input
                  type="number"
                  step="any"
                  id="start-bal-lite"
                  value="${appState.startingBalances.upi_lite}"
                  class="w-full h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono tabular-nums text-[#FAFAFA]"
                />
                <p class="text-[10px] text-zinc-500 font-mono tabular-nums mt-1">Live: ${formatINR(ledger.accountBalances.upi_lite)}</p>
              </div>
              <div>
                <label for="start-bal-cash" class="block text-[11px] text-zinc-400 mb-1">Physical Cash</label>
                <input
                  type="number"
                  step="any"
                  id="start-bal-cash"
                  value="${appState.startingBalances.cash}"
                  class="w-full h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono tabular-nums text-[#FAFAFA]"
                />
                <p class="text-[10px] text-zinc-500 font-mono tabular-nums mt-1">Live: ${formatINR(ledger.accountBalances.cash)}</p>
              </div>
            </div>

            <button
              type="submit"
              class="w-full min-h-[42px] rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[#FAFAFA] font-semibold text-xs transition-colors"
            >
              Update Starting Balances
            </button>
          </form>
        </section>

        <!-- Manage Categories -->
        <section aria-label="Manage Categories" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3">
          <div>
            <h2 class="text-sm font-semibold text-[#FAFAFA]">Categories & Bar Chart Visibility</h2>
            <p class="text-xs text-zinc-400 mt-0.5">Fixed overhead categories count in Monthly Budget but are excluded from the Category Bar Chart.</p>
          </div>

          <form id="add-category-form" class="space-y-2.5 pt-1">
            <div class="flex items-center gap-2">
              <input
                type="text"
                id="new-category-name"
                placeholder="New category name (e.g. Broadband)..."
                aria-label="New category name"
                class="flex-1 h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA] placeholder-zinc-500"
              />
              <button
                type="submit"
                class="min-h-[40px] px-3.5 rounded-xl bg-[#10B981] text-zinc-950 font-semibold text-xs whitespace-nowrap"
              >
                + Add Category
              </button>
            </div>
            <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                id="new-category-exclude"
                class="w-4 h-4 rounded accent-emerald-500"
              />
              <span>Exclude from Category Bar Chart (Fixed Overhead)</span>
            </label>
          </form>

          <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
            ${categoriesHTML}
          </div>
        </section>

        <!-- Offline Data Management (JSON Backup / Restore & CSV Export) -->
        <section aria-label="Offline Backup and Export" class="bg-[#18181B] border border-[#27272A] rounded-2xl p-4 space-y-3">
          <div>
            <h2 class="text-sm font-semibold text-[#FAFAFA]">Offline Data Backup & Portability</h2>
            <p class="text-xs text-zinc-400 mt-0.5">100% local IndexedDB + localStorage persistence. Export or restore anytime.</p>
          </div>

          <div class="grid grid-cols-1 gap-2">
            <button
              type="button"
              data-action="export-json"
              class="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-xs font-semibold text-[#FAFAFA] flex items-center justify-between transition-colors"
            >
              <span class="flex items-center gap-2">
                <i data-lucide="download" class="w-4 h-4 text-emerald-400"></i>
                <span>Export Full JSON Backup</span>
              </span>
              <span class="text-[11px] text-zinc-500 font-mono">.json</span>
            </button>

            <label
              class="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-xs font-semibold text-[#FAFAFA] flex items-center justify-between cursor-pointer transition-colors"
            >
              <span class="flex items-center gap-2">
                <i data-lucide="upload" class="w-4 h-4 text-emerald-400"></i>
                <span>Import JSON Backup File</span>
              </span>
              <span class="text-[11px] text-zinc-500 font-mono">Restore</span>
              <input type="file" id="import-json-file-input" accept=".json,application/json" class="hidden" />
            </label>

            <button
              type="button"
              data-action="toggle-json-paste"
              class="min-h-[40px] px-4 py-2 rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-xs font-medium text-zinc-300 flex items-center justify-between transition-colors"
            >
              <span class="flex items-center gap-2">
                <i data-lucide="clipboard-paste" class="w-4 h-4 text-zinc-400"></i>
                <span>Copy / Paste Raw JSON Backup</span>
              </span>
              <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-500"></i>
            </button>

            <button
              type="button"
              data-action="export-csv"
              class="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-xs font-semibold text-[#FAFAFA] flex items-center justify-between transition-colors"
            >
              <span class="flex items-center gap-2">
                <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i>
                <span>Export Master Ledger CSV</span>
              </span>
              <span class="text-[11px] text-zinc-500 font-mono">.csv</span>
            </button>
          </div>

          ${
            ui.jsonDrawerMode
              ? `
                <div class="pt-3 border-t border-[#27272A] space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-zinc-200">Raw JSON Ledger State</span>
                    <button type="button" data-action="close-json-drawer" class="text-xs text-zinc-400 hover:text-white">Close</button>
                  </div>
                  <textarea
                    id="json-paste-textarea"
                    rows="5"
                    aria-label="Raw JSON Backup Data"
                    class="w-full p-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-[11px] font-mono text-zinc-200"
                  >${escapeHTML(ui.jsonTextBuffer)}</textarea>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      data-action="apply-json-paste"
                      class="flex-1 min-h-[38px] rounded-xl bg-[#10B981] text-zinc-950 font-semibold text-xs"
                    >
                      Restore from JSON Text
                    </button>
                  </div>
                </div>
              `
              : ''
          }

          <!-- Reset / Clear Data Controls -->
          <div class="pt-3 border-t border-[#27272A] flex items-center gap-2">
            ${
              ui.confirmResetMode
                ? `
                  <span class="text-xs text-rose-400 mr-auto">
                    ${ui.confirmResetMode === 'demo' ? 'Restore demo seed data?' : 'Wipe all transactions?'}
                  </span>
                  <button
                    type="button"
                    data-action="cancel-reset"
                    class="min-h-[38px] px-3 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-action="confirm-reset"
                    class="min-h-[38px] px-3 rounded-xl bg-[#F43F5E] text-white text-xs font-semibold"
                  >
                    Confirm
                  </button>
                `
                : `
                  <button
                    type="button"
                    data-action="request-reset-demo"
                    class="flex-1 min-h-[40px] rounded-xl bg-zinc-800/80 hover:bg-zinc-800 border border-[#27272A] text-zinc-300 text-xs font-medium"
                  >
                    Reset Demo Data
                  </button>
                  <button
                    type="button"
                    data-action="request-clear-all"
                    class="flex-1 min-h-[40px] rounded-xl bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/30 text-rose-400 text-xs font-medium"
                  >
                    Clear All Entries
                  </button>
                `
            }
          </div>
        </section>
      </div>
    `;
  }

  // ==========================================================================
  // CENTER '+' MODAL RENDERER (Expense | 1-Tap Transfer | Add Balance)
  // ==========================================================================

  function renderModal() {
    const modalRoot = document.getElementById('tx-modal-root');
    if (!modalRoot) return;

    if (!ui.modalOpen) {
      modalRoot.innerHTML = '';
      modalRoot.classList.add('hidden');
      return;
    }

    modalRoot.classList.remove('hidden');
    const isEditing = Boolean(ui.editingTxId);
    const splitPreview = getActiveExpenseSplitResult();

    let bodyHTML = '';
    if (ui.modalTab === 'expense') {
      bodyHTML = renderExpenseModalTab(splitPreview, isEditing);
    } else if (ui.modalTab === 'transfer') {
      bodyHTML = renderTransferModalTab(isEditing);
    } else {
      bodyHTML = renderIncomeModalTab(isEditing);
    }

    modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="${isEditing ? 'Edit Transaction' : 'Add Transaction'}"
          class="w-full max-w-[480px] max-h-[92vh] bg-[#18181B] border-t sm:border border-[#27272A] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl"
        >
          <!-- Modal Header & Segmented Tabs -->
          <div class="p-4 border-b border-[#27272A] space-y-3 shrink-0">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-bold text-[#FAFAFA]">
                ${isEditing ? 'Edit Ledger Entry' : 'New Ledger Entry'}
              </h2>
              <button
                type="button"
                data-action="close-modal"
                aria-label="Close modal"
                class="min-h-[36px] min-w-[36px] rounded-xl bg-[#09090B] border border-[#27272A] flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <i data-lucide="x" class="w-4 h-4"></i>
              </button>
            </div>

            <div class="grid grid-cols-3 gap-1 p-1 bg-[#09090B] border border-[#27272A] rounded-xl">
              <button
                type="button"
                data-modal-tab="expense"
                class="min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                  ui.modalTab === 'expense' ? 'bg-zinc-800 text-[#FAFAFA]' : 'text-zinc-400 hover:text-zinc-200'
                }"
              >
                Expense
              </button>
              <button
                type="button"
                data-modal-tab="transfer"
                class="min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                  ui.modalTab === 'transfer' ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
                }"
              >
                1-Tap Transfer
              </button>
              <button
                type="button"
                data-modal-tab="income"
                class="min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                  ui.modalTab === 'income' ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
                }"
              >
                Add Balance
              </button>
            </div>
          </div>

          <!-- Scrollable Modal Content -->
          <div class="p-4 overflow-y-auto space-y-4 flex-1">
            ${bodyHTML}
          </div>
        </div>
      </div>
    `;

    refreshIcons();
  }

  function renderExpenseModalTab(splitPreview, isEditing) {
    const isItemized = ui.expIsSplit && ui.expSplitMode === 'itemized';
    const displayedAmount = isItemized ? String(splitPreview.totalAmount || '') : ui.expAmount;

    const categoryButtonsHTML = appState.categories
      .map((cat) => {
        const active = ui.expCategoryId === cat.id;
        return `
          <button
            type="button"
            data-exp-category="${cat.id}"
            class="min-h-[52px] px-1.5 py-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-colors ${
              active
                ? 'bg-emerald-500/15 border-emerald-500 text-[#FAFAFA]'
                : 'bg-[#09090B] border-[#27272A] text-zinc-400 hover:text-zinc-200'
            }"
          >
            <i data-lucide="${escapeHTML(cat.icon || 'tag')}" class="w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-zinc-400'}"></i>
            <span class="text-[11px] font-medium truncate w-full text-center">${escapeHTML(cat.name)}</span>
          </button>
        `;
      })
      .join('');

    const paidViaButtonsHTML = [
      { id: 'upi', label: 'UPI', isAccount: true },
      { id: 'upi_lite', label: 'UPI Lite', isAccount: true },
      { id: 'cash', label: 'Cash', isAccount: true },
      { id: 'friend_paid', label: 'Friend Paid', isAccount: false }
    ]
      .map((opt) => {
        const isSelected = opt.isAccount
          ? ui.expPayer === 'me' && ui.expAccountId === opt.id
          : ui.expPayer !== 'me';
        return `
          <button
            type="button"
            data-exp-paid-via="${opt.id}"
            class="min-h-[42px] px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
              isSelected
                ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                : 'bg-[#09090B] border-[#27272A] text-zinc-400 hover:text-zinc-200'
            }"
          >
            ${opt.label}
          </button>
        `;
      })
      .join('');

    return `
      <!-- Amount + Date Row -->
      <div class="grid grid-cols-5 gap-2.5">
        <div class="col-span-3">
          <label for="exp-amount-input" class="block text-[11px] font-medium text-zinc-400 mb-1">
            Total Bill Amount (₹)
          </label>
          <div class="relative">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-mono font-bold text-zinc-400">₹</span>
            <input
              type="number"
              step="any"
              min="0"
              id="exp-amount-input"
              value="${escapeHTML(displayedAmount)}"
              ${isItemized ? 'readonly' : ''}
              placeholder="0"
              class="w-full h-12 pl-8 pr-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xl font-mono tabular-nums font-bold text-[#FAFAFA] focus:outline-none focus:border-emerald-500 ${
                isItemized ? 'opacity-80 cursor-not-allowed' : ''
              }"
            />
          </div>
        </div>

        <div class="col-span-2">
          <label for="exp-date-input" class="block text-[11px] font-medium text-zinc-400 mb-1">Date</label>
          <input
            type="date"
            id="exp-date-input"
            value="${escapeHTML(ui.expDate)}"
            class="w-full h-12 px-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono text-[#FAFAFA] focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      <!-- Category 2-Row Grid Selector -->
      <div>
        <label class="block text-[11px] font-medium text-zinc-400 mb-1.5">Category (10 Pre-loaded)</label>
        <div class="grid grid-cols-5 gap-1.5">
          ${categoryButtonsHTML}
        </div>
      </div>

      <!-- Paid Via Selector (UPI, UPI Lite, Cash, or Friend Paid) -->
      <div class="space-y-2">
        <label class="block text-[11px] font-medium text-zinc-400">Paid Via</label>
        <div class="grid grid-cols-4 gap-1.5">
          ${paidViaButtonsHTML}
        </div>

        ${
          ui.expPayer !== 'me'
            ? `
              <div class="pt-1">
                <label for="exp-friend-payer-select" class="block text-[11px] text-amber-400 mb-1">
                  Which friend paid the bill? (Your accounts change by ₹0; your share counts in today's spend)
                </label>
                <select
                  id="exp-friend-payer-select"
                  class="w-full h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA]"
                >
                  ${appState.friends
                    .map(
                      (f) => `
                      <option value="${f.id}" ${ui.expPayer === f.id ? 'selected' : ''}>
                        ${escapeHTML(f.name)}
                      </option>
                    `
                    )
                    .join('')}
                </select>
              </div>
            `
            : ''
        }
      </div>

      <!-- Expandable Split Bill Drawer -->
      <div class="bg-[#09090B] border border-[#27272A] rounded-2xl p-3.5 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold text-[#FAFAFA]">Split Bill with Friends</p>
            <p class="text-[11px] text-zinc-400">Separates Cash Flow from your Personal Share (myShare)</p>
          </div>
          <button
            type="button"
            data-action="toggle-exp-split"
            aria-pressed="${ui.expIsSplit ? 'true' : 'false'}"
            class="min-h-[36px] px-3 py-1 rounded-xl text-xs font-semibold border transition-colors ${
              ui.expIsSplit
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                : 'bg-[#18181B] border-[#27272A] text-zinc-400'
            }"
          >
            ${ui.expIsSplit ? 'Split Active' : 'Split Bill'}
          </button>
        </div>

        ${ui.expIsSplit ? renderSplitDrawerInternals(splitPreview) : ''}
      </div>

      <!-- Note Input -->
      <div>
        <label for="exp-note-input" class="block text-[11px] font-medium text-zinc-400 mb-1">Note</label>
        <input
          type="text"
          id="exp-note-input"
          value="${escapeHTML(ui.expNote)}"
          placeholder="What was this for? (e.g. Lunch, Uber, Groceries)"
          class="w-full h-11 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA] placeholder-zinc-500"
        />
      </div>

      ${
        ui.expError
          ? `<p class="text-xs text-[#F43F5E] font-medium bg-rose-950/30 border border-rose-500/30 rounded-xl p-2.5">${escapeHTML(ui.expError)}</p>`
          : ''
      }

      <!-- Submit Button -->
      <button
        type="button"
        data-action="submit-modal-tx"
        class="w-full min-h-[48px] rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-bold text-sm transition-colors"
      >
        ${isEditing ? 'Save Changes & Reconcile' : 'Save Expense'}
      </button>
    `;
  }

  function renderSplitDrawerInternals(splitPreview) {
    const selectedFriends = appState.friends.filter((f) => ui.expSelectedFriends[f.id]);

    const friendChipsHTML = appState.friends
      .map((f) => {
        const checked = Boolean(ui.expSelectedFriends[f.id]);
        return `
          <button
            type="button"
            data-toggle-split-friend="${f.id}"
            class="min-h-[36px] px-3 py-1 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              checked
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'bg-[#18181B] border-[#27272A] text-zinc-400'
            }"
          >
            <i data-lucide="${checked ? 'check-square' : 'square'}" class="w-3.5 h-3.5"></i>
            <span>${escapeHTML(f.name)}</span>
          </button>
        `;
      })
      .join('');

    let modeSpecificHTML = '';

    if (ui.expSplitMode === 'equal') {
      modeSpecificHTML = `
        <div class="space-y-2 pt-1">
          <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              id="exp-equal-include-me"
              ${ui.expEqualIncludeMe ? 'checked' : ''}
              class="w-4 h-4 rounded accent-emerald-500"
            />
            <span>Include me in equal split (${selectedFriends.length + (ui.expEqualIncludeMe ? 1 : 0)} people)</span>
          </label>
        </div>
      `;
    } else if (ui.expSplitMode === 'itemized') {
      modeSpecificHTML = `
        <div class="space-y-2 pt-1">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] text-zinc-400 mb-1">Your Item Subtotal (₹)</label>
              <input
                type="number"
                step="any"
                min="0"
                id="exp-my-base-item"
                value="${escapeHTML(ui.expMyBaseItem)}"
                placeholder="0"
                class="w-full h-9 px-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-xs font-mono text-[#FAFAFA]"
              />
            </div>
            <div>
              <label class="block text-[10px] text-amber-400 mb-1">Tax / Delivery / Extra (₹)</label>
              <input
                type="number"
                step="any"
                min="0"
                id="exp-tax-extra"
                value="${escapeHTML(ui.expTaxOrExtra)}"
                placeholder="0"
                class="w-full h-9 px-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-xs font-mono text-[#FAFAFA]"
              />
            </div>
          </div>

          <div class="space-y-1.5">
            ${selectedFriends
              .map(
                (f) => `
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs text-zinc-300 truncate">${escapeHTML(f.name)} Item (₹)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    data-friend-base-item="${f.id}"
                    value="${escapeHTML(ui.expFriendBaseItems[f.id] || '')}"
                    placeholder="0"
                    class="w-28 h-9 px-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-xs font-mono text-right text-[#FAFAFA]"
                  />
                </div>
              `
              )
              .join('')}
          </div>
        </div>
      `;
    } else if (ui.expSplitMode === 'manual') {
      modeSpecificHTML = `
        <div class="space-y-2 pt-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-emerald-400">Your Exact Share (₹)</span>
            <input
              type="number"
              step="any"
              min="0"
              id="exp-my-manual-share"
              value="${escapeHTML(ui.expMyManualShare)}"
              placeholder="0"
              class="w-28 h-9 px-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-xs font-mono text-right text-[#FAFAFA]"
            />
          </div>

          ${selectedFriends
            .map(
              (f) => `
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-zinc-300 truncate">${escapeHTML(f.name)} Exact Share (₹)</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  data-friend-manual-share="${f.id}"
                  value="${escapeHTML(ui.expFriendManualShares[f.id] || '')}"
                  placeholder="0"
                  class="w-28 h-9 px-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-xs font-mono text-right text-[#FAFAFA]"
                />
              </div>
            `
            )
            .join('')}

          <button
            type="button"
            data-action="auto-balance-manual-share"
            class="w-full min-h-[34px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium"
          >
            Auto-Adjust Remainder Into My Share
          </button>
        </div>
      `;
    }

    return `
      <!-- 3 Split Calculation Modes -->
      <div class="grid grid-cols-3 gap-1 p-1 bg-[#18181B] border border-[#27272A] rounded-xl">
        ${[
          { id: 'equal', label: 'Equal Split' },
          { id: 'itemized', label: 'Itemized + Tax' },
          { id: 'manual', label: 'Manual Share' }
        ]
          .map(
            (m) => `
            <button
              type="button"
              data-split-mode="${m.id}"
              class="min-h-[34px] rounded-lg text-[11px] font-semibold transition-colors ${
                ui.expSplitMode === m.id ? 'bg-zinc-700 text-[#FAFAFA]' : 'text-zinc-400 hover:text-zinc-200'
              }"
            >
              ${m.label}
            </button>
          `
          )
          .join('')}
      </div>

      <!-- Participating Friends Selector -->
      <div>
        <p class="text-[11px] text-zinc-400 mb-1.5">Select Participating Friends:</p>
        <div class="flex flex-wrap gap-1.5">
          ${friendChipsHTML}
        </div>
      </div>

      ${modeSpecificHTML}

      <!-- Live Split Math Reconciliation Banner -->
      <div
        data-testid="split-live-preview"
        class="p-2.5 rounded-xl border text-xs font-mono tabular-nums ${
          splitPreview.isValid
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        }"
      >
        ${escapeHTML(splitPreview.summaryText)}
      </div>
    `;
  }

  function renderTransferModalTab(isEditing) {
    return `
      <div class="space-y-3.5">
        <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300">
          1-Tap Internal Transfer moves money between your accounts with <strong>₹0 impact</strong> on Today's Spend or your Monthly Budget.
        </div>

        <!-- 1-Tap Quick Route Presets -->
        <div>
          <label class="block text-[11px] font-medium text-zinc-400 mb-1.5">Quick Transfer Route</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-transfer-preset="upi_to_lite"
              class="min-h-[48px] p-2.5 rounded-xl border text-left transition-colors ${
                ui.trfPreset === 'upi_to_lite'
                  ? 'bg-emerald-500/15 border-emerald-500 text-[#FAFAFA]'
                  : 'bg-[#09090B] border-[#27272A] text-zinc-400'
              }"
            >
              <p class="text-xs font-semibold">UPI → UPI Lite</p>
              <p class="text-[10px] text-zinc-400 mt-0.5">Instant Wallet Top-Up</p>
            </button>

            <button
              type="button"
              data-transfer-preset="upi_to_cash"
              class="min-h-[48px] p-2.5 rounded-xl border text-left transition-colors ${
                ui.trfPreset === 'upi_to_cash'
                  ? 'bg-emerald-500/15 border-emerald-500 text-[#FAFAFA]'
                  : 'bg-[#09090B] border-[#27272A] text-zinc-400'
              }"
            >
              <p class="text-xs font-semibold">UPI → Physical Cash</p>
              <p class="text-[10px] text-zinc-400 mt-0.5">ATM / Cash Withdrawal</p>
            </button>
          </div>
        </div>

        <!-- Source & Destination Selectors -->
        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label for="trf-from-select" class="block text-[11px] text-zinc-400 mb-1">From Account</label>
            <select
              id="trf-from-select"
              class="w-full h-11 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA]"
            >
              ${ACCOUNTS.map(
                (a) => `<option value="${a.id}" ${ui.trfFromAccount === a.id ? 'selected' : ''}>${a.name}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label for="trf-to-select" class="block text-[11px] text-zinc-400 mb-1">To Account</label>
            <select
              id="trf-to-select"
              class="w-full h-11 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA]"
            >
              ${ACCOUNTS.map(
                (a) => `<option value="${a.id}" ${ui.trfToAccount === a.id ? 'selected' : ''}>${a.name}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <!-- Amount + Quick Chips -->
        <div>
          <label for="trf-amount-input" class="block text-[11px] font-medium text-zinc-400 mb-1">Transfer Amount (₹)</label>
          <input
            type="number"
            step="any"
            min="0"
            id="trf-amount-input"
            value="${escapeHTML(ui.trfAmount)}"
            placeholder="500"
            class="w-full h-12 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xl font-mono tabular-nums font-bold text-[#FAFAFA]"
          />
          <div class="flex items-center gap-1.5 mt-2">
            ${[200, 500, 1000, 2000]
              .map(
                (amt) => `
                <button
                  type="button"
                  data-quick-trf-amt="${amt}"
                  class="flex-1 min-h-[34px] rounded-lg bg-[#09090B] hover:bg-zinc-800 border border-[#27272A] text-xs font-mono text-zinc-300"
                >
                  +₹${amt}
                </button>
              `
              )
              .join('')}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label for="trf-date-input" class="block text-[11px] text-zinc-400 mb-1">Date</label>
            <input
              type="date"
              id="trf-date-input"
              value="${escapeHTML(ui.trfDate)}"
              class="w-full h-10 px-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono text-[#FAFAFA]"
            />
          </div>
          <div>
            <label for="trf-note-input" class="block text-[11px] text-zinc-400 mb-1">Optional Note</label>
            <input
              type="text"
              id="trf-note-input"
              value="${escapeHTML(ui.trfNote)}"
              placeholder="Top-up / ATM"
              class="w-full h-10 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA]"
            />
          </div>
        </div>

        ${
          ui.trfError
            ? `<p class="text-xs text-[#F43F5E] font-medium bg-rose-950/30 border border-rose-500/30 rounded-xl p-2.5">${escapeHTML(ui.trfError)}</p>`
            : ''
        }

        <button
          type="button"
          data-action="submit-modal-tx"
          class="w-full min-h-[48px] rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-bold text-sm transition-colors"
        >
          ${isEditing ? 'Update Transfer' : 'Complete 1-Tap Transfer'}
        </button>
      </div>
    `;
  }

  function renderIncomeModalTab(isEditing) {
    return `
      <div class="space-y-3.5">
        <div class="p-3 rounded-xl bg-zinc-800/80 border border-[#27272A] text-xs text-zinc-300">
          Log external money received (Salary, Refund, Cash Deposit) directly into an account balance.
        </div>

        <div>
          <label class="block text-[11px] font-medium text-zinc-400 mb-1.5">Deposit Into Account</label>
          <div class="grid grid-cols-3 gap-2">
            ${ACCOUNTS.map(
              (acc) => `
              <button
                type="button"
                data-inc-account="${acc.id}"
                class="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  ui.incAccount === acc.id
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                    : 'bg-[#09090B] border-[#27272A] text-zinc-400'
                }"
              >
                ${acc.name}
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="grid grid-cols-5 gap-2.5">
          <div class="col-span-3">
            <label for="inc-amount-input" class="block text-[11px] text-zinc-400 mb-1">Amount Received (₹)</label>
            <input
              type="number"
              step="any"
              min="0"
              id="inc-amount-input"
              value="${escapeHTML(ui.incAmount)}"
              placeholder="0"
              class="w-full h-12 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xl font-mono tabular-nums font-bold text-[#10B981]"
            />
          </div>
          <div class="col-span-2">
            <label for="inc-date-input" class="block text-[11px] text-zinc-400 mb-1">Date</label>
            <input
              type="date"
              id="inc-date-input"
              value="${escapeHTML(ui.incDate)}"
              class="w-full h-12 px-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono text-[#FAFAFA]"
            />
          </div>
        </div>

        <div>
          <label for="inc-note-input" class="block text-[11px] text-zinc-400 mb-1">Source / Note</label>
          <input
            type="text"
            id="inc-note-input"
            value="${escapeHTML(ui.incNote)}"
            placeholder="e.g. Salary Credit, Cashback, ATM Deposit"
            class="w-full h-11 px-3.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs text-[#FAFAFA]"
          />
        </div>

        ${
          ui.incError
            ? `<p class="text-xs text-[#F43F5E] font-medium bg-rose-950/30 border border-rose-500/30 rounded-xl p-2.5">${escapeHTML(ui.incError)}</p>`
            : ''
        }

        <button
          type="button"
          data-action="submit-modal-tx"
          class="w-full min-h-[48px] rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-bold text-sm transition-colors"
        >
          ${isEditing ? 'Update Balance Entry' : 'Add Balance to Account'}
        </button>
      </div>
    `;
  }

  // ==========================================================================
  // SETTLE UP & FORGIVE DEBT MODALS
  // ==========================================================================

  function renderSettleModal() {
    const root = document.getElementById('settle-modal-root');
    if (!root) return;
    if (!ui.settleModalOpen) {
      root.innerHTML = '';
      root.classList.add('hidden');
      return;
    }

    root.classList.remove('hidden');
    const friend = appState.friends.find((f) => f.id === ui.settleFriendId);
    const friendName = friend ? friend.name : 'Friend';

    root.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settle Up with ${escapeHTML(friendName)}"
          class="w-full max-w-[440px] bg-[#18181B] border-t sm:border border-[#27272A] rounded-t-3xl sm:rounded-3xl p-4 space-y-4 shadow-2xl"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-[#FAFAFA]">Settle Up · ${escapeHTML(friendName)}</h2>
            <button
              type="button"
              data-action="close-settle-modal"
              aria-label="Close settle up modal"
              class="min-h-[36px] min-w-[36px] rounded-xl bg-[#09090B] border border-[#27272A] flex items-center justify-center text-zinc-400"
            >
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>

          <p class="text-xs text-zinc-400">
            Supports partial or lump-sum settlements. Adjusts your Account Balance and ${escapeHTML(friendName)}'s Net Balance with ₹0 impact on Monthly Budget.
          </p>

          <!-- Direction Selector -->
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-settle-direction="friend_paid_me"
              class="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold ${
                ui.settleDirection === 'friend_paid_me'
                  ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                  : 'bg-[#09090B] border-[#27272A] text-zinc-400'
              }"
            >
              ${escapeHTML(friendName)} Paid Me
            </button>
            <button
              type="button"
              data-settle-direction="i_paid_friend"
              class="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold ${
                ui.settleDirection === 'i_paid_friend'
                  ? 'bg-rose-500/15 border-rose-500 text-rose-400'
                  : 'bg-[#09090B] border-[#27272A] text-zinc-400'
              }"
            >
              I Paid ${escapeHTML(friendName)}
            </button>
          </div>

          <!-- Amount & Date -->
          <div class="grid grid-cols-5 gap-2">
            <div class="col-span-3">
              <label for="settle-amount-input" class="block text-[11px] text-zinc-400 mb-1">Settlement Amount (₹)</label>
              <input
                type="number"
                step="any"
                min="0"
                id="settle-amount-input"
                value="${escapeHTML(ui.settleAmount)}"
                placeholder="0"
                class="w-full h-11 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-base font-mono tabular-nums font-bold text-[#FAFAFA]"
              />
            </div>
            <div class="col-span-2">
              <label for="settle-date-input" class="block text-[11px] text-zinc-400 mb-1">Date</label>
              <input
                type="date"
                id="settle-date-input"
                value="${escapeHTML(ui.settleDate)}"
                class="w-full h-11 px-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono text-[#FAFAFA]"
              />
            </div>
          </div>

          <!-- Account Selector -->
          <div>
            <label class="block text-[11px] text-zinc-400 mb-1.5">Account</label>
            <div class="grid grid-cols-3 gap-2">
              ${ACCOUNTS.map(
                (acc) => `
                <button
                  type="button"
                  data-settle-account="${acc.id}"
                  class="min-h-[40px] rounded-xl border text-xs font-semibold ${
                    ui.settleAccountId === acc.id
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                      : 'bg-[#09090B] border-[#27272A] text-zinc-400'
                  }"
                >
                  ${acc.name}
                </button>
              `
              ).join('')}
            </div>
          </div>

          ${
            ui.settleError
              ? `<p class="text-xs text-[#F43F5E] font-medium">${escapeHTML(ui.settleError)}</p>`
              : ''
          }

          <button
            type="button"
            data-action="confirm-settle-up"
            class="w-full min-h-[46px] rounded-xl bg-[#10B981] hover:bg-emerald-400 text-zinc-950 font-bold text-sm"
          >
            Record Settlement
          </button>
        </div>
      </div>
    `;
    refreshIcons();
  }

  function renderForgiveModal() {
    const root = document.getElementById('forgive-modal-root');
    if (!root) return;
    if (!ui.forgiveModalOpen) {
      root.innerHTML = '';
      root.classList.add('hidden');
      return;
    }

    root.classList.remove('hidden');
    const friend = appState.friends.find((f) => f.id === ui.forgiveFriendId);
    const friendName = friend ? friend.name : 'Friend';

    root.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Forgive or Round Off Debt for ${escapeHTML(friendName)}"
          class="w-full max-w-[440px] bg-[#18181B] border-t sm:border border-[#27272A] rounded-t-3xl sm:rounded-3xl p-4 space-y-4 shadow-2xl"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-[#FAFAFA]">Forgive / Round Off Debt · ${escapeHTML(friendName)}</h2>
            <button
              type="button"
              data-action="close-forgive-modal"
              aria-label="Close forgive modal"
              class="min-h-[36px] min-w-[36px] rounded-xl bg-[#09090B] border border-[#27272A] flex items-center justify-center text-zinc-400"
            >
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>

          <p class="text-xs text-zinc-300 leading-relaxed">
            Forgiving debt reduces ${escapeHTML(friendName)}'s owed balance and automatically logs a personal expense under
            <strong>Miscellaneous</strong> (with auto-note <code>"Forgiven debt - ${escapeHTML(friendName)}"</code>) so your Monthly Budget absorbs the cost.
          </p>

          <div class="grid grid-cols-5 gap-2">
            <div class="col-span-3">
              <label for="forgive-amount-input" class="block text-[11px] text-zinc-400 mb-1">Amount to Forgive (₹)</label>
              <input
                type="number"
                step="any"
                min="0"
                id="forgive-amount-input"
                value="${escapeHTML(ui.forgiveAmount)}"
                class="w-full h-11 px-3 bg-[#09090B] border border-[#27272A] rounded-xl text-base font-mono tabular-nums font-bold text-[#FAFAFA]"
              />
            </div>
            <div class="col-span-2">
              <label for="forgive-date-input" class="block text-[11px] text-zinc-400 mb-1">Date</label>
              <input
                type="date"
                id="forgive-date-input"
                value="${escapeHTML(ui.forgiveDate)}"
                class="w-full h-11 px-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-xs font-mono text-[#FAFAFA]"
              />
            </div>
          </div>

          ${
            ui.forgiveError
              ? `<p class="text-xs text-[#F43F5E] font-medium">${escapeHTML(ui.forgiveError)}</p>`
              : ''
          }

          <button
            type="button"
            data-action="confirm-forgive-debt"
            class="w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm"
          >
            Forgive Debt & Log Expense
          </button>
        </div>
      </div>
    `;
    refreshIcons();
  }

  // ==========================================================================
  // EXPORT / IMPORT BACKUP UTILITIES (JSON & CSV)
  // ==========================================================================

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFullJSONBackup() {
    const jsonStr = JSON.stringify(appState, null, 2);
    ui.jsonDrawerMode = 'export';
    ui.jsonTextBuffer = jsonStr;
    downloadBlob(jsonStr, `rupeeledger-backup-${getTodayISO()}.json`, 'application/json');
    renderApp();
    showToast('Exported JSON backup');
  }

  function exportMasterCSV() {
    const friendsMap = {};
    appState.friends.forEach((f) => {
      friendsMap[f.id] = f.name;
    });
    const catsMap = {};
    appState.categories.forEach((c) => {
      catsMap[c.id] = c.name;
    });

    const headers = ['ID', 'Date', 'Type', 'Category', 'TotalAmount', 'MyPersonalShare', 'Payer', 'Account', 'Note'];
    const rows = appState.transactions.map((tx) => [
      tx.id,
      tx.date,
      tx.type,
      catsMap[tx.categoryId] || tx.type,
      roundCurrency(tx.amount),
      roundCurrency(tx.myShare !== undefined ? tx.myShare : 0),
      tx.payer === 'me' ? 'Me' : (friendsMap[tx.payer] || 'Me'),
      tx.accountId || tx.fromAccountId || '',
      `"${String(tx.note || '').replace(/"/g, '""')}"`
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadBlob(csv, `rupeeledger-transactions-${getTodayISO()}.csv`, 'text/csv;charset=utf-8;');
    showToast('Exported CSV spreadsheet');
  }

  // ==========================================================================
  // EVENT DELEGATION & INPUT LISTENERS
  // ==========================================================================

  function attachEventListeners() {
    document.addEventListener('click', async (e) => {
      const target = e.target.closest('button, [data-nav-tab], [data-action]');
      if (!target) return;

      // Bottom Navigation Tabs
      const navTab = target.getAttribute('data-nav-tab');
      if (navTab) {
        ui.activeTab = navTab;
        ui.confirmDeleteTxId = null;
        renderApp();
        return;
      }

      // Center '+' FAB
      if (target.id === 'fab-add-btn') {
        openAddModal('expense');
        return;
      }

      // Header PWA Install Button
      if (target.id === 'header-install-btn') {
        if (ui.deferredInstallPrompt) {
          ui.deferredInstallPrompt.prompt();
          const choice = await ui.deferredInstallPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            ui.isStandalone = true;
            ui.deferredInstallPrompt = null;
            renderApp();
          }
        } else if (ui.isIOS) {
          showToast('On iPhone Safari: Tap Share → Add to Home Screen');
        }
        return;
      }

      // Generic Action Triggers
      const action = target.getAttribute('data-action');
      if (action === 'quick-transfer' || target.id === 'header-transfer-btn') {
        openAddModal('transfer', 'upi_to_lite');
        return;
      }
      if (action === 'quick-add-balance') {
        openAddModal('income');
        return;
      }
      if (action === 'close-modal') {
        closeMainModal();
        return;
      }
      if (action === 'toggle-exp-split') {
        ui.expIsSplit = !ui.expIsSplit;
        renderModal();
        return;
      }
      if (action === 'auto-balance-manual-share') {
        const total = roundCurrency(ui.expAmount);
        const friendsSum = appState.friends
          .filter((f) => ui.expSelectedFriends[f.id])
          .reduce((acc, f) => roundCurrency(acc + roundCurrency(ui.expFriendManualShares[f.id] || 0)), 0);
        ui.expMyManualShare = String(Math.max(0, roundCurrency(total - friendsSum)));
        renderModal();
        return;
      }
      if (action === 'submit-modal-tx') {
        handleSaveTransaction();
        return;
      }
      if (action === 'close-settle-modal') {
        ui.settleModalOpen = false;
        renderSettleModal();
        return;
      }
      if (action === 'confirm-settle-up') {
        handleConfirmSettleUp();
        return;
      }
      if (action === 'close-forgive-modal') {
        ui.forgiveModalOpen = false;
        renderForgiveModal();
        return;
      }
      if (action === 'confirm-forgive-debt') {
        handleConfirmForgive();
        return;
      }
      if (action === 'export-json') {
        exportFullJSONBackup();
        return;
      }
      if (action === 'toggle-json-paste') {
        ui.jsonDrawerMode = ui.jsonDrawerMode ? null : 'import';
        ui.jsonTextBuffer = JSON.stringify(appState, null, 2);
        renderApp();
        return;
      }
      if (action === 'close-json-drawer') {
        ui.jsonDrawerMode = null;
        renderApp();
        return;
      }
      if (action === 'apply-json-paste') {
        const textarea = document.getElementById('json-paste-textarea');
        if (textarea) {
          try {
            const parsed = JSON.parse(textarea.value);
            if (parsed && Array.isArray(parsed.transactions)) {
              appState = storage.normalizeState(parsed);
              ui.jsonDrawerMode = null;
              persistAndRender('Backup restored & all balances recalculated');
            } else {
              showToast('Invalid JSON backup structure');
            }
          } catch (_err) {
            showToast('Invalid JSON syntax');
          }
        }
        return;
      }
      if (action === 'export-csv') {
        exportMasterCSV();
        return;
      }
      if (action === 'request-reset-demo') {
        ui.confirmResetMode = 'demo';
        renderApp();
        return;
      }
      if (action === 'request-clear-all') {
        ui.confirmResetMode = 'clear';
        renderApp();
        return;
      }
      if (action === 'cancel-reset') {
        ui.confirmResetMode = null;
        renderApp();
        return;
      }
      if (action === 'confirm-reset') {
        if (ui.confirmResetMode === 'demo') {
          appState = createInitialSeedState();
          ui.confirmResetMode = null;
          persistAndRender('Demo seed ledger restored');
        } else {
          appState.transactions = [];
          ui.confirmResetMode = null;
          persistAndRender('All transactions cleared');
        }
        return;
      }

      // Modal Segmented Top Tabs
      const modalTab = target.getAttribute('data-modal-tab');
      if (modalTab) {
        ui.modalTab = modalTab;
        renderModal();
        return;
      }

      // Expense Category selection
      const expCat = target.getAttribute('data-exp-category');
      if (expCat) {
        ui.expCategoryId = expCat;
        renderModal();
        return;
      }

      // Paid Via selection
      const paidVia = target.getAttribute('data-exp-paid-via');
      if (paidVia) {
        if (paidVia === 'friend_paid') {
          ui.expPayer = appState.friends[0]?.id || 'me';
        } else {
          ui.expPayer = 'me';
          ui.expAccountId = paidVia;
        }
        renderModal();
        return;
      }

      // Split Mode selection
      const splitMode = target.getAttribute('data-split-mode');
      if (splitMode) {
        ui.expSplitMode = splitMode;
        renderModal();
        return;
      }

      // Toggle Friend in Split
      const splitFriendId = target.getAttribute('data-toggle-split-friend');
      if (splitFriendId) {
        ui.expSelectedFriends[splitFriendId] = !ui.expSelectedFriends[splitFriendId];
        renderModal();
        return;
      }

      // Transfer Route Presets
      const trfPreset = target.getAttribute('data-transfer-preset');
      if (trfPreset) {
        ui.trfPreset = trfPreset;
        if (trfPreset === 'upi_to_lite') {
          ui.trfFromAccount = 'upi';
          ui.trfToAccount = 'upi_lite';
        } else if (trfPreset === 'upi_to_cash') {
          ui.trfFromAccount = 'upi';
          ui.trfToAccount = 'cash';
        }
        renderModal();
        return;
      }

      // Quick Transfer Amount Chip
      const quickTrfAmt = target.getAttribute('data-quick-trf-amt');
      if (quickTrfAmt) {
        ui.trfAmount = String(roundCurrency(ui.trfAmount || 0) + Number(quickTrfAmt));
        renderModal();
        return;
      }

      // Income Account Selection
      const incAcc = target.getAttribute('data-inc-account');
      if (incAcc) {
        ui.incAccount = incAcc;
        renderModal();
        return;
      }

      // Transaction Feed Filter
      const txFilter = target.getAttribute('data-tx-filter');
      if (txFilter) {
        ui.txFilter = txFilter;
        renderApp();
        return;
      }

      // Edit / Delete Transaction
      const editTxId = target.getAttribute('data-edit-tx');
      if (editTxId) {
        openEditModal(editTxId);
        return;
      }
      const deleteTxId = target.getAttribute('data-delete-tx');
      if (deleteTxId) {
        ui.confirmDeleteTxId = deleteTxId;
        renderApp();
        return;
      }
      const cancelDeleteTxId = target.getAttribute('data-cancel-delete-tx');
      if (cancelDeleteTxId) {
        ui.confirmDeleteTxId = null;
        renderApp();
        return;
      }
      const confirmDeleteTxId = target.getAttribute('data-confirm-delete-tx');
      if (confirmDeleteTxId) {
        appState.transactions = appState.transactions.filter((t) => t.id !== confirmDeleteTxId);
        ui.confirmDeleteTxId = null;
        persistAndRender('Transaction deleted & balances recalculated');
        return;
      }

      // Friends Tab Actions
      const settleFriendId = target.getAttribute('data-settle-friend');
      if (settleFriendId) {
        openSettleUpModal(settleFriendId);
        return;
      }
      const forgiveFriendId = target.getAttribute('data-forgive-friend');
      if (forgiveFriendId) {
        openForgiveModal(forgiveFriendId);
        return;
      }
      const toggleHistoryFriendId = target.getAttribute('data-toggle-friend-history');
      if (toggleHistoryFriendId) {
        ui.expandedFriendIds[toggleHistoryFriendId] = !ui.expandedFriendIds[toggleHistoryFriendId];
        renderApp();
        return;
      }

      // Settle Modal Direction & Account
      const settleDir = target.getAttribute('data-settle-direction');
      if (settleDir) {
        ui.settleDirection = settleDir;
        renderSettleModal();
        return;
      }
      const settleAcc = target.getAttribute('data-settle-account');
      if (settleAcc) {
        ui.settleAccountId = settleAcc;
        renderSettleModal();
        return;
      }

      // Analytics Month Navigation
      const monthNav = target.getAttribute('data-analytics-month-nav');
      if (monthNav) {
        ui.analyticsMonthISO = monthNav === 'prev'
          ? getPreviousMonthISO(ui.analyticsMonthISO)
          : getNextMonthISO(ui.analyticsMonthISO);
        renderApp();
        return;
      }

      // Settings Category Bar Chart Visibility Toggle & Delete
      const toggleCatId = target.getAttribute('data-toggle-cat-chart');
      if (toggleCatId) {
        appState.categories = appState.categories.map((c) =>
          c.id === toggleCatId ? { ...c, excludeFromBarChart: !c.excludeFromBarChart } : c
        );
        persistAndRender('Category chart visibility updated');
        return;
      }
      const deleteCatId = target.getAttribute('data-delete-cat');
      if (deleteCatId) {
        appState.categories = appState.categories.filter((c) => c.id !== deleteCatId);
        persistAndRender('Custom category removed');
      }
    });

    // Live Input Binding for Modal & Search
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el) return;

      if (el.id === 'tx-search-input') {
        ui.searchQuery = el.value;
        const cursorPos = el.selectionStart;
        renderApp();
        const nextInput = document.getElementById('tx-search-input');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(cursorPos, cursorPos);
        }
        return;
      }

      // Expense Modal Inputs
      if (el.id === 'exp-amount-input') {
        ui.expAmount = el.value;
        ui.expError = '';
        updateSplitLiveBannerInDOM();
        return;
      }
      if (el.id === 'exp-date-input') {
        ui.expDate = el.value;
        return;
      }
      if (el.id === 'exp-note-input') {
        ui.expNote = el.value;
        return;
      }
      if (el.id === 'exp-my-base-item') {
        ui.expMyBaseItem = el.value;
        updateSplitLiveBannerInDOM(true);
        return;
      }
      if (el.id === 'exp-tax-extra') {
        ui.expTaxOrExtra = el.value;
        updateSplitLiveBannerInDOM(true);
        return;
      }
      if (el.id === 'exp-my-manual-share') {
        ui.expMyManualShare = el.value;
        updateSplitLiveBannerInDOM();
        return;
      }

      const friendBaseId = el.getAttribute('data-friend-base-item');
      if (friendBaseId) {
        ui.expFriendBaseItems[friendBaseId] = el.value;
        updateSplitLiveBannerInDOM(true);
        return;
      }

      const friendManualId = el.getAttribute('data-friend-manual-share');
      if (friendManualId) {
        ui.expFriendManualShares[friendManualId] = el.value;
        updateSplitLiveBannerInDOM();
        return;
      }

      // Transfer Modal Inputs
      if (el.id === 'trf-amount-input') {
        ui.trfAmount = el.value;
        ui.trfError = '';
        return;
      }
      if (el.id === 'trf-date-input') {
        ui.trfDate = el.value;
        return;
      }
      if (el.id === 'trf-note-input') {
        ui.trfNote = el.value;
        return;
      }

      // Income Modal Inputs
      if (el.id === 'inc-amount-input') {
        ui.incAmount = el.value;
        ui.incError = '';
        return;
      }
      if (el.id === 'inc-date-input') {
        ui.incDate = el.value;
        return;
      }
      if (el.id === 'inc-note-input') {
        ui.incNote = el.value;
        return;
      }

      // Settle & Forgive Inputs
      if (el.id === 'settle-amount-input') {
        ui.settleAmount = el.value;
        ui.settleError = '';
        return;
      }
      if (el.id === 'settle-date-input') {
        ui.settleDate = el.value;
        return;
      }
      if (el.id === 'forgive-amount-input') {
        ui.forgiveAmount = el.value;
        ui.forgiveError = '';
        return;
      }
      if (el.id === 'forgive-date-input') {
        ui.forgiveDate = el.value;
      }
    });

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el) return;

      if (el.id === 'exp-friend-payer-select') {
        ui.expPayer = el.value;
        renderModal();
        return;
      }
      if (el.id === 'exp-equal-include-me') {
        ui.expEqualIncludeMe = el.checked;
        renderModal();
        return;
      }
      if (el.id === 'trf-from-select') {
        ui.trfFromAccount = el.value;
        ui.trfPreset = 'custom';
        renderModal();
        return;
      }
      if (el.id === 'trf-to-select') {
        ui.trfToAccount = el.value;
        ui.trfPreset = 'custom';
        renderModal();
        return;
      }
      if (el.id === 'import-json-file-input' && el.files && el.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.target.result));
            if (parsed && Array.isArray(parsed.transactions)) {
              appState = storage.normalizeState(parsed);
              persistAndRender('JSON backup imported & balances reconciled');
            } else {
              showToast('Invalid JSON backup file');
            }
          } catch (_err) {
            showToast('Failed to parse JSON file');
          }
        };
        reader.readAsText(el.files[0]);
      }
    });

    // Form Submissions (Add Friend, Save Budget, Save Starting Balances, Add Category)
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form) return;
      e.preventDefault();

      if (form.id === 'add-friend-form') {
        const input = document.getElementById('new-friend-name-input');
        const name = (input?.value || '').trim();
        if (!name) return;
        const newFriend = {
          id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          createdAt: Date.now()
        };
        appState.friends.push(newFriend);
        ui.expSelectedFriends[newFriend.id] = true;
        persistAndRender(`Added ${name} to Friends`);
        return;
      }

      if (form.id === 'settings-budget-form') {
        const input = document.getElementById('settings-budget-input');
        const val = roundCurrency(input?.value || 0);
        if (val > 0) {
          appState.monthlyBudget = val;
          persistAndRender(`Monthly budget updated to ${formatINR(val)}`);
        }
        return;
      }

      if (form.id === 'settings-balances-form') {
        const upi = roundCurrency(document.getElementById('start-bal-upi')?.value || 0);
        const lite = roundCurrency(document.getElementById('start-bal-lite')?.value || 0);
        const cash = roundCurrency(document.getElementById('start-bal-cash')?.value || 0);
        appState.startingBalances = { upi, upi_lite: lite, cash };
        persistAndRender('Starting balances updated & live accounts reconciled');
        return;
      }

      if (form.id === 'add-category-form') {
        const nameInput = document.getElementById('new-category-name');
        const excludeCheck = document.getElementById('new-category-exclude');
        const name = (nameInput?.value || '').trim();
        if (!name) return;
        const id = `cat_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`;
        appState.categories.push({
          id,
          name,
          icon: excludeCheck?.checked ? 'building' : 'tag',
          excludeFromBarChart: Boolean(excludeCheck?.checked),
          isSystem: false
        });
        persistAndRender(`Category "${name}" added`);
      }
    });
  }

  function updateSplitLiveBannerInDOM(syncItemizedTotal = false) {
    const preview = getActiveExpenseSplitResult();
    if (syncItemizedTotal) {
      ui.expAmount = String(preview.totalAmount || '');
      const amtInput = document.getElementById('exp-amount-input');
      if (amtInput) amtInput.value = ui.expAmount;
    }
    const banner = document.querySelector('[data-testid="split-live-preview"]');
    if (banner) {
      banner.textContent = preview.summaryText;
      banner.className = `p-2.5 rounded-xl border text-xs font-mono tabular-nums ${
        preview.isValid
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
      }`;
    }
  }

  // ==========================================================================
  // SERVICE WORKER, PWA INSTALL & OFFLINE STATUS INITIALIZATION
  // ==========================================================================

  function initPWAAndConnectivity() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      ui.deferredInstallPrompt = e;
      renderApp();
    });

    window.addEventListener('appinstalled', () => {
      ui.isStandalone = true;
      ui.deferredInstallPrompt = null;
      renderApp();
    });

    const updateConnectivityUI = () => {
      const badge = document.getElementById('offline-status-badge');
      if (!badge) return;
      if (navigator.onLine) {
        badge.classList.add('hidden');
      } else {
        badge.classList.remove('hidden');
      }
    };

    window.addEventListener('online', updateConnectivityUI);
    window.addEventListener('offline', updateConnectivityUI);
    updateConnectivityUI();
  }

  // Initialize App on DOM Ready
  const startApp = async () => {
    attachEventListeners();
    initPWAAndConnectivity();
    renderApp();

    // Check IndexedDB backup if localStorage was reset
    const idbState = await storage.syncFromIDBIfEmpty();
    if (idbState && idbState.transactions.length > appState.transactions.length) {
      appState = idbState;
      renderApp();
    } else {
      storage.saveToIDB(appState);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}
