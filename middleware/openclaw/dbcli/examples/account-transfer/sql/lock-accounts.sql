SELECT account_id
FROM finance.account
WHERE account_id IN (:from_account_id, :to_account_id)
  AND status = 'ACTIVE'
ORDER BY account_id
FOR UPDATE;

