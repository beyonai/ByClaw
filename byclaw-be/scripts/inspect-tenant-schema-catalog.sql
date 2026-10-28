-- Read-only diagnostics. Connect to the affected tenant database, not the shared BE database.
-- Use the tenant Node database role so sequence visibility matches the runtime fingerprint.
-- Export every result set as JSON; these queries inspect schema metadata, never business rows.
SELECT version() AS database_version, current_database() AS database_name, current_user AS database_user;
SELECT obj_description(oid, 'pg_namespace') AS schema_marker
FROM pg_namespace WHERE nspname='byai';

-- objects
SELECT c.relname AS name, c.relkind AS kind, obj_description(c.oid,'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='byai' ORDER BY c.relname;

-- columns
SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value,col_description(c.oid,a.attnum) AS comment
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='byai' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;

-- indexes
SELECT c.relname AS name,pg_get_indexdef(c.oid) AS definition FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='byai' AND c.relkind IN('i','I') ORDER BY c.relname;

-- constraints
SELECT c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='byai' ORDER BY c.relname,k.conname;

-- sequences
SELECT sequence_name,data_type,start_value,minimum_value,maximum_value,increment,cycle_option
    FROM information_schema.sequences WHERE sequence_schema='byai' ORDER BY sequence_name;
