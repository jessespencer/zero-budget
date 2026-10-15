-- Repair legacy credit_card accounts that stored debt as a positive
-- current_balance. Pre-260515-k43, createAccount({type:'credit_card',
-- currentBalance: N}) inserted the row at +N (wrong: an asset value) and
-- emitted no starting-balance transaction. Every downstream consumer that
-- expects debt-as-negative (Transfer Plan paymentDue, sidebar totals,
-- holdings-list grouping, net-worth math) was off by 2x for those rows.
--
-- This migration is sign-conservative: only rows where the account is
-- a debt account (is_debt = 1) AND current_balance > 0 are negated.
-- Rows already stored negative (correctly entered by the user or
-- migrated by some other path) and zero-balance rows are untouched.
-- transfer_plan_actuals was audited at design time and contains no
-- positive credit-card values (the BalanceInput component has auto-negated
-- positive credit-card entries before persisting since the Transfer Plan
-- shipped in v1.0), so no second UPDATE on that table is needed.

UPDATE accounts
SET current_balance = -current_balance,
    updated_at = datetime('now')
WHERE is_debt = 1 AND current_balance > 0;
