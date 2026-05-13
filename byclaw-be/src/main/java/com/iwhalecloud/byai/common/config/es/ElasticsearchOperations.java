package com.iwhalecloud.byai.common.config.es;

import java.util.List;
import java.util.Map;

public interface ElasticsearchOperations {

    // 索引文档
    void index(String index, String id, Map<String, Object> document);

    // 批量索引文档
    void bulkIndex(String index, List<Map<String, Object>> documents);

    // 根据ID获取文档
    Map<String, Object> getById(String index, String id);

    // 搜索文档
    List<Map<String, Object>> search(String index, Map<String, Object> query);

    // 更新文档
    void update(String index, String id, Map<String, Object> document);

    // 删除文档
    void delete(String index, String id);

    // 检查索引是否存在
    boolean indexExists(String index);

    // 创建索引
    void createIndex(String index, Map<String, Object> mappings);

    // 删除索引
    void deleteIndex(String index);

    // 多个索引的全文检索
    List<Map<String, Object>> fullSearch(List<String> searchIndexNames, String searchValue, int size);
}
