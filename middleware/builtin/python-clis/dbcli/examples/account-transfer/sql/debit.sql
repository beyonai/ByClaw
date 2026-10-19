UPDATE finance.account
SET balance = balance - :amount,
    updated_at = CURRENT_TIMESTAMP
WHERE account_id = :from_account_id
  AND status = 'ACTIVE'
  AND balance >= :amount;

