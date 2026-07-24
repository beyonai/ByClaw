package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RecorderRankServiceTest {

    private final RecorderRankService service = new RecorderRankService();

    @Test
    void ranksVaryingSearchEndpointAheadOfMonitoringTraffic() {
        RecorderSession session = new RecorderSession("session_1", new RecorderOwner(1L, "alice"));
        session.samples().put("A", List.of(
            entry("monitor", "POST", "https://mon.zijieapi.com/monitor_web/settings/browser-settings?bid=2608&store=1"),
            entry("search-a", "GET", "https://api.juejin.cn/search_api/v1/search?aid=2608&query=java&cursor=0")
        ));
        session.samples().put("B", List.of(
            entry("search-b", "GET", "https://api.juejin.cn/search_api/v1/search?aid=2608&query=ts&cursor=0"),
            entry("config", "POST", "https://vcs.zijieapi.com/vc/setting")
        ));

        List<Map<String, Object>> candidates = service.rank(session);

        assertThat(candidates).isNotEmpty();
        assertThat(candidates.getFirst().get("id")).isEqualTo("cand_api_juejin_cn_search_api_v1_search");
        assertThat(candidates.getFirst())
            .extractingByKey("endpoint")
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
            .extractingByKey("urlTemplate")
            .isEqualTo("https://api.juejin.cn/search_api/v1/search?aid={aid}&query={query}&cursor={cursor}");
        assertThat(candidates.toString()).doesNotContain("mon.zijieapi.com", "vcs.zijieapi.com");
    }

    @Test
    @SuppressWarnings("unchecked")
    void derivesRowFieldsFromCapturedJsonWithoutExposingTheResponseBody() {
        RecorderSession session = new RecorderSession("session_1", new RecorderOwner(1L, "alice"));
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("requestId", "search-a");
        entry.put("method", "GET");
        entry.put("url", "https://api.example.test/search?q=java");
        entry.put("responseBody", "{\"data\":{\"items\":[{\"title\":\"private-title\",\"id\":1,\"author\":{\"name\":\"private-author\"}}]}}");
        session.samples().put("A", List.of(entry));

        Map<String, Object> candidate = service.rank(session).getFirst();
        List<Map<String, Object>> columns = (List<Map<String, Object>>) candidate.get("columns");

        assertThat(columns).extracting(column -> column.get("name")).containsExactly("title", "id");
        assertThat(candidate)
            .extractingByKey("endpoint")
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
            .containsEntry("rowPath", "$.data.items[]");
        assertThat(candidate.toString()).doesNotContain("private-title", "private-author", "responseBody");
    }

    private static Map<String, Object> entry(String requestId, String method, String url) {
        return Map.of("requestId", requestId, "method", method, "url", url);
    }
}
