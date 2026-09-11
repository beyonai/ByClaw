package com.iwhalecloud.byai.manager.dto.datasource;

import java.util.Map;

public record DataSourceView(String datasourceId, String datasourceName, String description, String datasourceType,
        Map<String, Object> connectionConfig, boolean hasPassword, boolean canEdit, boolean canManageBinding) {
}
