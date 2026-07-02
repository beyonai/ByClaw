package com.iwhalecloud.byai.state.application.service.langfuse;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Langfuse 用量查询服务
 * <p>
 * 通过 Langfuse v1 Metrics Daily API 获取指定用户的 Token 消耗汇总数据，
 * 包括总用量和按模型维度的分组统计。
 * </p>
 *
 * @see <a href="https://langfuse.com/changelog/2024-02-19-metrics-api-endpoint">Langfuse Metrics Daily API</a>
 */
@Service
public class LangfuseUsageService {

    private static final Logger log = LoggerFactory.getLogger(LangfuseUsageService.class);

    @Value("${langfuse.base-url:}")
    private String baseUrl;

    @Value("${langfuse.public-key:}")
    private String publicKey;

    @Value("${langfuse.secret-key:}")
    private String secretKey;

    private final RestTemplate restTemplate = new RestTemplate();

    /**
     * 查询指定用户的 Token 用量汇总
     *
     * @param userId 用户工号（对应 Langfuse 中的 userId）
     * @return 包含 used(总token数)、modelUsages(按模型分组的用量列表) 的 Map
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getUserUsage(String userId) {
        Map<String, Object> result = new HashMap<>();
        result.put("used", 0L);
        result.put("modelUsages", List.of());

        if (baseUrl == null || baseUrl.isEmpty() || publicKey == null || publicKey.isEmpty()) {
            return result;
        }

        try {
            HttpHeaders headers = buildAuthHeaders();
            URI uri = URI.create(baseUrl + "/api/public/metrics/daily?userId=" + userId + "&limit=100");
            ResponseEntity<Map> response = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

            Map<String, Object> body = response.getBody();
            if (body == null || !body.containsKey("data")) {
                return result;
            }

            List<Map<String, Object>> dailyData = (List<Map<String, Object>>) body.get("data");
            if (dailyData == null || dailyData.isEmpty()) {
                return result;
            }

            String currentMonthPrefix = YearMonth.now().format(DateTimeFormatter.ofPattern("yyyy-MM"));
            long totalTokens = 0;
            Map<String, long[]> modelMap = new HashMap<>();

            for (Map<String, Object> day : dailyData) {
                String date = day.get("date") != null ? day.get("date").toString() : "";
                if (!date.startsWith(currentMonthPrefix)) {
                    continue;
                }
                List<Map<String, Object>> usages = (List<Map<String, Object>>) day.get("usage");
                if (usages == null) continue;
                for (Map<String, Object> u : usages) {
                    String model = u.get("model") != null ? u.get("model").toString() : null;
                    long tokens = toLong(u.get("totalUsage"));
                    totalTokens += tokens;
                    if (model != null && !model.isEmpty()) {
                        modelMap.computeIfAbsent(model, k -> new long[]{0})[0] += tokens;
                    }
                }
            }

            result.put("used", totalTokens);

            List<Map<String, Object>> modelUsages = new ArrayList<>();
            modelMap.forEach((model, arr) -> {
                Map<String, Object> m = new HashMap<>();
                m.put("modelCode", model);
                m.put("displayName", model);
                m.put("tokensUsed", arr[0]);
                modelUsages.add(m);
            });
            modelUsages.sort((a, b) -> Long.compare((long) b.get("tokensUsed"), (long) a.get("tokensUsed")));
            result.put("modelUsages", modelUsages);

        } catch (Exception e) {
            log.warn("Failed to fetch Langfuse usage for user={}: {}", userId, e.getMessage());
        }
        return result;
    }

    /**
     * 构建 Langfuse Basic Auth 请求头（publicKey:secretKey 的 Base64 编码）
     */
    private HttpHeaders buildAuthHeaders() {
        String auth = Base64.getEncoder().encodeToString(
            (publicKey + ":" + secretKey).getBytes(StandardCharsets.UTF_8));
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Basic " + auth);
        return headers;
    }

    private long toLong(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).longValue();
        try { return Long.parseLong(val.toString()); } catch (NumberFormatException e) { return 0; }
    }

    /**
     * 查询指定用户本月受限模型的 Token 用量合计
     * <p>
     * 从 Langfuse daily 数据中筛选当月日期内、且 model 在 quotaModelCodes 集合中的用量求和。
     * </p>
     *
     * @param userId          用户工号
     * @param quotaModelCodes 受限模型编码集合
     * @return 本月受限模型的 token 总消耗
     */
    @SuppressWarnings("unchecked")
    public long getMonthlyQuotaUsage(String userId, Set<String> quotaModelCodes) {
        if (baseUrl == null || baseUrl.isEmpty() || publicKey == null || publicKey.isEmpty()) {
            return 0;
        }
        if (quotaModelCodes == null || quotaModelCodes.isEmpty()) {
            return 0;
        }

        try {
            HttpHeaders headers = buildAuthHeaders();
            URI uri = URI.create(baseUrl + "/api/public/metrics/daily?userId=" + userId + "&limit=100");
            ResponseEntity<Map> response = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

            Map<String, Object> body = response.getBody();
            if (body == null || !body.containsKey("data")) {
                return 0;
            }

            List<Map<String, Object>> dailyData = (List<Map<String, Object>>) body.get("data");
            if (dailyData == null || dailyData.isEmpty()) {
                return 0;
            }

            String currentMonthPrefix = YearMonth.now().format(DateTimeFormatter.ofPattern("yyyy-MM"));
            long total = 0;

            for (Map<String, Object> day : dailyData) {
                String date = day.get("date") != null ? day.get("date").toString() : "";
                if (!date.startsWith(currentMonthPrefix)) {
                    continue;
                }
                List<Map<String, Object>> usages = (List<Map<String, Object>>) day.get("usage");
                if (usages == null) continue;
                for (Map<String, Object> u : usages) {
                    String model = u.get("model") != null ? u.get("model").toString() : null;
                    if (model != null && quotaModelCodes.contains(model)) {
                        total += toLong(u.get("totalUsage"));
                    }
                }
            }
            return total;
        } catch (Exception e) {
            log.warn("Failed to fetch monthly quota usage from Langfuse for user={}: {}", userId, e.getMessage());
            return 0;
        }
    }
}
