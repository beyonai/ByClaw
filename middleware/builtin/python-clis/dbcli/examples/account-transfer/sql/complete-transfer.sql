UPDATE finance.transfer_request
SET status = 'SUCCESS',
    completed_at = CURRENT_TIMESTAMP
WHERE request_id = :request_id
  AND status = 'PROCESSING';

