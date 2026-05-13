package com.iwhalecloud.byai.common.config.es;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.core.BulkResponse;
import co.elastic.clients.elasticsearch.core.GetResponse;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.bulk.BulkOperation;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import com.iwhalecloud.byai.common.exception.BaseException;
import org.apache.http.HttpHost;
import org.apache.http.auth.AuthScope;
import org.apache.http.auth.UsernamePasswordCredentials;
import org.apache.http.client.CredentialsProvider;
import org.apache.http.impl.client.BasicCredentialsProvider;
import org.elasticsearch.client.RestClient;
import org.elasticsearch.client.RestClientBuilder;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class Elasticsearch8Operations implements ElasticsearchOperations {

    private final ElasticsearchClient client;
    private final RestClient restClient;

    public Elasticsearch8Operations(String hosts, String username, String password) {
        // 解析hosts
        List<HttpHost> httpHosts = Arrays.stream(hosts.split(","))
                .map(host -> {
                    String[] parts = host.split("://");
                    String protocol = parts.length > 1 ? parts[0] : "http";
                    String[] hostPort = (parts.length > 1 ? parts[1] : parts[0]).split(":");
                    return new HttpHost(hostPort[0], Integer.parseInt(hostPort[1]), protocol);
                })
                .collect(Collectors.toList());

        RestClientBuilder builder = RestClient.builder(httpHosts.toArray(new HttpHost[0]));

        // 配置认证信息
        if (username != null && password != null) {
            final CredentialsProvider credentialsProvider = new BasicCredentialsProvider();
            credentialsProvider.setCredentials(AuthScope.ANY,
                    new UsernamePasswordCredentials(username, password));

            builder.setHttpClientConfigCallback(httpClientBuilder -> 
                httpClientBuilder.setDefaultCredentialsProvider(credentialsProvider));
        }

        // 配置超时时间
        builder.setRequestConfigCallback(requestConfigBuilder -> requestConfigBuilder
                .setConnectTimeout(5000)
                .setSocketTimeout(60000)
                .setConnectionRequestTimeout(5000));

        // 创建传输层和客户端
        this.restClient = builder.build();
        RestClientTransport transport = new RestClientTransport(
            this.restClient, 
            new JacksonJsonpMapper()
        );
        this.client = new ElasticsearchClient(transport);
    }

    @Override
    public void index(String index, String id, Map<String, Object> document) {
        try {
            client.index(i -> i
                    .index(index)
                    .id(id)
                    .document(document)
            );
        } catch (Exception e) {
            throw new BaseException("Error indexing document", e);
        }
    }

    @Override
    public void bulkIndex(String index, List<Map<String, Object>> documents) {
        try {
            List<BulkOperation> operations = new ArrayList<>();
            
            for (Map<String, Object> doc : documents) {
                // 处理可能的 BigDecimal、Timestamp 等类型
                Map<String, Object> processedDoc = new HashMap<>();
                for (Map.Entry<String, Object> entry : doc.entrySet()) {
                    Object value = entry.getValue();
                    if (value != null) {
                        // 转换为基本类型
                        if (value instanceof java.math.BigDecimal) {
                            processedDoc.put(entry.getKey(), ((java.math.BigDecimal) value).doubleValue());
                        } else if (value instanceof java.sql.Timestamp) {
                            processedDoc.put(entry.getKey(), ((java.sql.Timestamp) value).getTime());
                        } else if (value instanceof java.sql.Date) {
                            processedDoc.put(entry.getKey(), ((java.sql.Date) value).getTime());
                        } else {
                            processedDoc.put(entry.getKey(), value.toString());
                        }
                    }
                }

                String docId = doc.containsKey("id") ? 
                    doc.get("id").toString() : 
                    UUID.randomUUID().toString();

                operations.add(BulkOperation.of(b -> b
                    .index(i -> i
                        .index(index)
                        .id(docId)
                        .document(processedDoc)
                    )
                ));
            }

            BulkResponse response = client.bulk(b -> b.operations(operations));
            
            if (response.errors()) {
                throw new BaseException("Bulk indexing encountered errors: " +
                    response.items().stream()
                        .filter(item -> item.error() != null)
                        .map(item -> item.error().reason())
                        .collect(Collectors.joining(", ")));
            }
        } catch (Exception e) {
            throw new BaseException("Error bulk indexing documents", e);
        }
    }

    @Override
    public Map<String, Object> getById(String index, String id) {
        try {
            GetResponse<Map> response = client.get(g -> g
                            .index(index)
                            .id(id),
                    Map.class
            );
            return response.source();
        } catch (Exception e) {
            throw new BaseException("Error getting document by id", e);
        }
    }

    @Override
    public List<Map<String, Object>> search(String index, Map<String, Object> query) {
        try {
             client.search(s -> s
                    .index(index)
                    .query(q -> {
                        if (query != null && !query.isEmpty()) {
                            return q.match(m -> m
                                .field("_all")
                                .query(query.toString())
                            );
                        } else {
                            return q.matchAll(m -> m);
                        }
                    }),
                    Map.class
            );
            
            return null;
        } catch (Exception e) {
            throw new BaseException("Error searching documents", e);
        }
    }

    @Override
    public void update(String index, String id, Map<String, Object> document) {
        try {
            client.update(u -> u
                            .index(index)
                            .id(id)
                            .doc(document),
                    Map.class
            );
        } catch (Exception e) {
            throw new BaseException("Error updating document", e);
        }
    }

    @Override
    public void delete(String index, String id) {
        try {
            client.delete(d -> d
                    .index(index)
                    .id(id)
            );
        } catch (Exception e) {
            throw new BaseException("Error deleting document", e);
        }
    }

    @Override
    public boolean indexExists(String index) {
        try {
            return client.indices().exists(e -> e.index(index)).value();
        } catch (Exception e) {
            throw new BaseException("Error checking index existence", e);
        }
    }

    @Override
    public void createIndex(String index, Map<String, Object> mappings) {
        try {
//            String inputMappings = JSON.toJSONString(mappings);
//            Map<String, Property> propertyMap = JSON.parseObject(inputMappings,
//                new TypeReference<Map<String, Property>>() {});
            
            client.indices().create(c -> c
                    .index(index)
//                    .mappings(m -> m.properties(propertyMap))
            );
        } catch (Exception e) {
            throw new BaseException("Error creating index", e);
        }
    }

    @Override
    public void deleteIndex(String index) {
        try {
            client.indices().delete(d -> d.index(index));
        } catch (Exception e) {
            throw new BaseException("Error deleting index", e);
        }
    }

    @Override
    public List<Map<String, Object>> fullSearch(List<String> searchIndexNames, String searchValue, int size) {
        try {
            // 检查索引是否存在
            List<String> existingIndices = new ArrayList<>();
            for (String indexName : searchIndexNames) {
                if (indexExists(indexName)) {
                    existingIndices.add(indexName);
                }
            }
            
            if (existingIndices.isEmpty()) {
                return new ArrayList<>();
            }

            // 执行搜索
            SearchResponse<Map> response = client.search(s -> s
                    .index(existingIndices)
                    .query(q -> q
                        .queryString(qs -> qs
                            .query(searchValue)
                        )
                    )
                    .size(size),
                    Map.class
            );

            // 处理结果
            return response.hits().hits().stream()
                    .map(hit -> {
                        Map<String, Object> resultMap = new HashMap<>();
                        resultMap.put("index", hit.index());
                        resultMap.put("hits", hit.source());
                        return resultMap;
                    })
                    .collect(Collectors.toList());
        } catch (Exception e) {
            throw new BaseException("Error performing full search", e);
        }
    }

    public void close() {
        try {
            if (restClient != null) {
                restClient.close();
            }
        } catch (IOException e) {
            throw new BaseException("Error closing client", e);
        }
    }
}