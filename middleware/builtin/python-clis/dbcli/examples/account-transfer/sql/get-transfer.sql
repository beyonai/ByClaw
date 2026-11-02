SELECT
  request_id,
  from_account_id,
  to_account_id,
  amount,
  status,
  CASE
    WHEN from_account_id = :from_account_id
     AND to_account_id = :to_account_id
     AND amount = :amount
    THEN TRUE
    ELSE FALSE
  END AS same_request
FROM finance.transfer_request
WHERE request_id = :request_id;
