package com.iwhalecloud.byai.manager.domain.datasource;

import java.util.Map;

/** Type-specific validation owns the complete allowlist of non-secret configuration fields. */
public interface DataSourceTypeProvider {
    String type();
    Map<String, Object> validate(Map<String, Object> config);
}
