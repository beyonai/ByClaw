INSERT INTO finance.transfer_request (
  request_id,
  from_account_id,
  to_account_id,
  amount,
  status,
  created_at
)
VALUES (
  :request_id,
  :from_account_id,
  :to_account_id,
  :amount,
  'PROCESSING',
  CURRENT_TIMESTAMP
)
ON CONFLICT (request_id) DO NOTHING
RETURNING request_id;

