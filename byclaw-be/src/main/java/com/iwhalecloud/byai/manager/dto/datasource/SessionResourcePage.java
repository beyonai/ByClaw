package com.iwhalecloud.byai.manager.dto.datasource;

import java.util.List;
import java.util.Map;

public record SessionResourcePage(List<Map<String, Object>> items, long total, int pageNum, int pageSize) {
}
