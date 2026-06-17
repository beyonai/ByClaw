UPDATE byai.sandbox_service_spec
SET service_type = COALESCE(service_type, service_key),
    display_name = COALESCE(display_name, service_key),
    enabled = COALESCE(enabled, 1),
    default_profile_key = COALESCE(default_profile_key, CASE WHEN service_key = 'openclaw' THEN 'xs' ELSE NULL END),
    autoscale_enabled = COALESCE(autoscale_enabled, CASE WHEN service_key = 'openclaw' THEN 1 ELSE 0 END)
WHERE service_type IS NULL
   OR display_name IS NULL
   OR enabled IS NULL
   OR default_profile_key IS NULL
   OR autoscale_enabled IS NULL;



UPDATE byai.sandbox_service_profile
SET resource_requests = '{"cpu":"250m","memory":"765Mi"}'::jsonb,
    resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
    resize_enabled = 1,
    resize_strategy = 'IN_PLACE',
    enabled = 1,
    sort_order = 10,
    updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'xs';


INSERT INTO byai.sandbox_service_profile (
    service_type, profile_key, resource_requests, resource_limits,
    resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'xs', '{"cpu":"250m","memory":"765Mi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 10, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM byai.sandbox_service_profile WHERE service_type = 'openclaw' AND profile_key = 'xs');



UPDATE byai.sandbox_service_profile
SET resource_requests = '{"cpu":"500m","memory":"1Gi"}'::jsonb,
    resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
    resize_enabled = 1,
    resize_strategy = 'IN_PLACE',
    enabled = 1,
    sort_order = 20,
    updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 's';


INSERT INTO byai.sandbox_service_profile (
    service_type, profile_key, resource_requests, resource_limits,
    resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 's', '{"cpu":"500m","memory":"1Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 20, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM byai.sandbox_service_profile WHERE service_type = 'openclaw' AND profile_key = 's');



UPDATE byai.sandbox_service_profile
SET resource_requests = '{"cpu":"1","memory":"2Gi"}'::jsonb,
    resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
    resize_enabled = 1,
    resize_strategy = 'IN_PLACE',
    enabled = 1,
    sort_order = 30,
    updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'm';


INSERT INTO byai.sandbox_service_profile (
    service_type, profile_key, resource_requests, resource_limits,
    resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'm', '{"cpu":"1","memory":"2Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 30, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM byai.sandbox_service_profile WHERE service_type = 'openclaw' AND profile_key = 'm');



UPDATE byai.sandbox_service_profile
SET resource_requests = '{"cpu":"2","memory":"4Gi"}'::jsonb,
    resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
    resize_enabled = 1,
    resize_strategy = 'IN_PLACE',
    enabled = 1,
    sort_order = 40,
    updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'l';


INSERT INTO byai.sandbox_service_profile (
    service_type, profile_key, resource_requests, resource_limits,
    resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'l', '{"cpu":"2","memory":"4Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 40, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM byai.sandbox_service_profile WHERE service_type = 'openclaw' AND profile_key = 'l');
