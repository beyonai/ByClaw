-- Unify storage add-on addition and cancellation requests while retaining the
-- existing downgrade table for backward-compatible historical records.
CREATE OR REPLACE FUNCTION byai.add_storage_change_column_if_missing(
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'byai'
          AND table_name = 'po_user_storage_downgrade'
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE byai.po_user_storage_downgrade ADD COLUMN '
            || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.add_storage_change_column_if_missing('grant_ids', 'VARCHAR(2000)');
SELECT byai.add_storage_change_column_if_missing('package_names', 'VARCHAR(1000)');
SELECT byai.add_storage_change_column_if_missing('change_bytes', 'BIGINT NOT NULL DEFAULT 0');

DROP FUNCTION byai.add_storage_change_column_if_missing(TEXT, TEXT);

CREATE OR REPLACE FUNCTION byai.allow_storage_change_without_grant() RETURNS VOID AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'byai'
          AND table_name = 'po_user_storage_downgrade'
          AND column_name = 'grant_id'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE byai.po_user_storage_downgrade ALTER COLUMN grant_id DROP NOT NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.allow_storage_change_without_grant();
DROP FUNCTION byai.allow_storage_change_without_grant();
