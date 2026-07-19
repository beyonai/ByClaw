package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.state.domain.message.qo.MessageQo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 研发任务环节追踪服务。
 * 系统里不存在现成的环节数据，只能从会话消息派生：
 * 主路径解析数字员工按约定输出的 [PHASE] 打点标记（零成本、可靠、天然支持打回）；
 * 无打点的历史会话回退到 LLM 抽取。产出 7 环节进度快照，供任务详情逐环节展示。
 */
@Slf4j
@Service
public class DevloopPhaseService {

    private static final String PHASE_PROMPT_CODE = "DEVLOOP_PHASE_EXTRACT_PROMPT";

    /** 固定环节顺序：issue → req → design → coder → reviewer → tester → pr */
    public static final List<String> PHASE_ORDER =
        Arrays.asList("issue", "req", "design", "coder", "reviewer", "tester", "pr");

    /** 环节中文名，供前端直接展示，避免前端硬编码另一份映射造成口径漂移 */
    private static final Map<String, String> PHASE_LABELS = new LinkedHashMap<>();

    static {
        PHASE_LABELS.put("issue", "需求来源");
        PHASE_LABELS.put("req", "需求分析");
        PHASE_LABELS.put("design", "方案设计");
        PHASE_LABELS.put("coder", "编码");
        PHASE_LABELS.put("reviewer", "代码审查");
        PHASE_LABELS.put("tester", "测试");
        PHASE_LABELS.put("pr", "提交PR");
    }

    // 环节状态：未开始 / 进行中 / 通过 / 被打回
    public static final String ST_PENDING = "pending";
    public static final String ST_RUNNING = "running";
    public static final String ST_DONE = "done";
    public static final String ST_REJECTED = "rejected";

    // 派生来源：打点标记 / LLM 抽取 / 无信号（全未开始）
    private static final String SRC_MARKER = "marker";
    private static final String SRC_LLM = "llm";
    private static final String SRC_EMPTY = "empty";

    // 一个任务的完整对话回看上限，够覆盖多轮打回即可，避免超长会话拖慢解析
    private static final int MAX_MESSAGES = 100;

    // LLM 兜底时拼接的转录文本上限，防止超出模型上下文
    private static final int MAX_TRANSCRIPT_CHARS = 12000;

    /**
     * 打点标记：[PHASE] &lt;环节&gt; &lt;START|DONE|REJECT[-&gt;目标环节]&gt; [原因...]
     * 例：[PHASE] coder START   /   [PHASE] tester REJECT->coder 原因:单测未覆盖审计日志
     */
    private static final Pattern MARKER = Pattern.compile(
        "\\[PHASE\\]\\s*([A-Za-z]+)\\s+(START|DONE|REJECT)(?:\\s*-+>\\s*([A-Za-z]+))?(?:[\\s:：]+(.*))?",
        Pattern.CASE_INSENSITIVE);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private AIService aiService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /** 计算某会话(任务)的环节进度快照：优先打点标记，无标记回退 LLM，再无信号返回全未开始。 */
    public PhaseSnapshot buildSnapshot(Long sessionId) {
        List<ByaiMessageHotDto> messages = loadMessagesAscending(sessionId);
        int messageCount = messages.size();

        PhaseSnapshot byMarker = parseByMarkers(messages);
        if (byMarker != null) {
            byMarker.setMessageCount(messageCount);
            return byMarker;
        }
        PhaseSnapshot byLlm = parseByLlm(messages);
        if (byLlm != null) {
            byLlm.setMessageCount(messageCount);
            return byLlm;
        }
        PhaseSnapshot empty = emptySnapshot();
        empty.setMessageCount(messageCount);
        return empty;
    }

    /** 缓存是否失效：会话消息条数变化即认为需要重算，避免每次开详情都跑解析/LLM。 */
    public boolean isStale(PhaseSnapshot cached, long currentMessageCount) {
        return cached == null || cached.getMessageCount() != (int) currentMessageCount;
    }

    public long countMessages(Long sessionId) {
        return byaiMessageHotService.countBySessionId(sessionId);
    }

    public String toJson(PhaseSnapshot snapshot) {
        try {
            return MAPPER.writeValueAsString(snapshot);
        } catch (Exception e) {
            log.warn("[DevloopPhase] 快照序列化失败", e);
            return null;
        }
    }

    public PhaseSnapshot fromJson(String json) {
        if (json == null || json.isEmpty()) {
            return null;
        }
        try {
            return MAPPER.readValue(json, PhaseSnapshot.class);
        } catch (Exception e) {
            log.warn("[DevloopPhase] 快照反序列化失败: {}", json, e);
            return null;
        }
    }

    /** 总进度百分比：done 记 1、running 记 0.5，除以环节总数。列表与详情共用此口径，避免漂移。 */
    public int progressPercent(PhaseSnapshot snapshot) {
        if (snapshot == null || snapshot.getPhases() == null || snapshot.getPhases().isEmpty()) {
            return 0;
        }
        double sum = 0;
        for (PhaseState p : snapshot.getPhases()) {
            if (ST_DONE.equals(p.getStatus())) {
                sum += 1;
            } else if (ST_RUNNING.equals(p.getStatus())) {
                sum += 0.5;
            }
        }
        return (int) Math.round(sum / snapshot.getPhases().size() * 100);
    }

    /** 空快照：7 环节全未开始，当前停在首环节。 */
    public PhaseSnapshot emptySnapshot() {
        PhaseSnapshot snap = new PhaseSnapshot();
        snap.setSource(SRC_EMPTY);
        snap.setRound(1);
        snap.setCurrentPhase(PHASE_ORDER.get(0));
        snap.setPhases(initPhaseStates());
        snap.setKickbacks(new ArrayList<>());
        return snap;
    }

    /** 取会话消息并按时间升序返回（getMessages 为降序，此处反转便于按对话顺序推进环节）。 */
    private List<ByaiMessageHotDto> loadMessagesAscending(Long sessionId) {
        MessageQo qo = new MessageQo();
        qo.setSessionId(sessionId);
        qo.setTopK(MAX_MESSAGES);
        List<ByaiMessageHotDto> messages = byaiMessageHotService.getMessages(qo);
        if (messages == null || messages.isEmpty()) {
            return new ArrayList<>();
        }
        List<ByaiMessageHotDto> asc = new ArrayList<>(messages);
        java.util.Collections.reverse(asc);
        return asc;
    }

    /**
     * 打点解析：按对话顺序处理每条 [PHASE] 标记，维护各环节状态、轮次与打回记录。
     * 无任何标记时返回 null，交由 LLM 兜底。
     */
    private PhaseSnapshot parseByMarkers(List<ByaiMessageHotDto> messages) {
        Map<String, String> statusByPhase = new LinkedHashMap<>();
        for (String p : PHASE_ORDER) {
            statusByPhase.put(p, ST_PENDING);
        }
        List<Kickback> kickbacks = new ArrayList<>();
        int round = 1;
        String currentPhase = PHASE_ORDER.get(0);
        boolean any = false;

        for (ByaiMessageHotDto msg : messages) {
            String text = messageText(msg);
            if (text.isEmpty()) {
                continue;
            }
            Matcher m = MARKER.matcher(text);
            while (m.find()) {
                String phase = normalizePhase(m.group(1));
                if (phase == null) {
                    continue;
                }
                String action = m.group(2).toUpperCase();
                String target = normalizePhase(m.group(3));
                String reason = m.group(4) != null ? m.group(4).trim() : "";
                any = true;

                if ("START".equals(action)) {
                    markEarlierDone(statusByPhase, phase);
                    statusByPhase.put(phase, ST_RUNNING);
                    currentPhase = phase;
                } else if ("DONE".equals(action)) {
                    statusByPhase.put(phase, ST_DONE);
                    currentPhase = phase;
                } else if ("REJECT".equals(action)) {
                    statusByPhase.put(phase, ST_REJECTED);
                    round++;
                    String to = target != null ? target : "coder";
                    kickbacks.add(new Kickback(phase, to, round, reason));
                    // 打回后目标环节重新进行，其后到被打回环节之间的环节回退为未开始待重跑
                    resetForRework(statusByPhase, to, phase);
                    statusByPhase.put(to, ST_RUNNING);
                    currentPhase = to;
                }
            }
        }

        if (!any) {
            return null;
        }
        PhaseSnapshot snap = new PhaseSnapshot();
        snap.setSource(SRC_MARKER);
        snap.setRound(round);
        snap.setCurrentPhase(currentPhase);
        snap.setKickbacks(kickbacks);
        snap.setPhases(toPhaseStates(statusByPhase));
        return snap;
    }

    /** 开始某环节即认为其之前仍未开始的环节已通过（顺序流水线，跳过即视为完成）。 */
    private void markEarlierDone(Map<String, String> statusByPhase, String phase) {
        int idx = PHASE_ORDER.indexOf(phase);
        for (int i = 0; i < idx; i++) {
            String p = PHASE_ORDER.get(i);
            if (ST_PENDING.equals(statusByPhase.get(p))) {
                statusByPhase.put(p, ST_DONE);
            }
        }
    }

    /** 打回：目标环节与被打回环节之间（不含被打回环节）的中间环节回退为未开始，等待重跑。 */
    private void resetForRework(Map<String, String> statusByPhase, String target, String rejected) {
        int from = PHASE_ORDER.indexOf(target);
        int to = PHASE_ORDER.indexOf(rejected);
        if (from < 0 || to < 0) {
            return;
        }
        for (int i = from + 1; i < to; i++) {
            statusByPhase.put(PHASE_ORDER.get(i), ST_PENDING);
        }
    }

    /** LLM 兜底：把会话转录喂给模型抽取环节 JSON；无消息或未配置提示词时返回 null。 */
    private PhaseSnapshot parseByLlm(List<ByaiMessageHotDto> messages) {
        if (messages.isEmpty()) {
            return null;
        }
        String template = byaiSystemConfigService.findByParamCode(PHASE_PROMPT_CODE);
        if (template == null || template.isEmpty()) {
            log.warn("[DevloopPhase] 未配置环节抽取提示词 {}，跳过 LLM 兜底。", PHASE_PROMPT_CODE);
            return null;
        }
        String transcript = buildTranscript(messages);
        if (transcript.isEmpty()) {
            return null;
        }
        String userPrompt = template.replace("${transcript}", transcript);
        String raw;
        try {
            raw = aiService.generateText(null, userPrompt, null, 800);
        } catch (Exception e) {
            log.warn("[DevloopPhase] LLM 抽取环节失败", e);
            return null;
        }
        JsonNode node = parseJson(raw);
        if (node == null) {
            return null;
        }
        return snapshotFromLlmJson(node);
    }

    private PhaseSnapshot snapshotFromLlmJson(JsonNode node) {
        Map<String, String> statusByPhase = new LinkedHashMap<>();
        for (String p : PHASE_ORDER) {
            statusByPhase.put(p, ST_PENDING);
        }
        JsonNode phases = node.path("phases");
        if (phases.isArray()) {
            for (JsonNode ph : phases) {
                String key = normalizePhase(ph.path("key").asText(null));
                String status = normalizeStatus(ph.path("status").asText(null));
                if (key != null && status != null) {
                    statusByPhase.put(key, status);
                }
            }
        }
        List<Kickback> kickbacks = new ArrayList<>();
        JsonNode kbs = node.path("kickbacks");
        if (kbs.isArray()) {
            for (JsonNode kb : kbs) {
                String from = normalizePhase(kb.path("from").asText(null));
                String to = normalizePhase(kb.path("to").asText(null));
                if (from != null && to != null) {
                    kickbacks.add(new Kickback(from, to, kb.path("round").asInt(1), kb.path("reason").asText("")));
                }
            }
        }
        String currentPhase = normalizePhase(node.path("currentPhase").asText(null));
        if (currentPhase == null) {
            currentPhase = deriveCurrentPhase(statusByPhase);
        }
        PhaseSnapshot snap = new PhaseSnapshot();
        snap.setSource(SRC_LLM);
        snap.setRound(Math.max(1, node.path("round").asInt(1)));
        snap.setCurrentPhase(currentPhase);
        snap.setKickbacks(kickbacks);
        snap.setPhases(toPhaseStates(statusByPhase));
        return snap;
    }

    /** 无 currentPhase 时的推导：最高序号的进行中环节，否则最高序号的非未开始环节，否则首环节。 */
    private String deriveCurrentPhase(Map<String, String> statusByPhase) {
        String current = PHASE_ORDER.get(0);
        for (String p : PHASE_ORDER) {
            String st = statusByPhase.get(p);
            if (!ST_PENDING.equals(st)) {
                current = p;
            }
            if (ST_RUNNING.equals(st)) {
                return p;
            }
        }
        return current;
    }

    private List<PhaseState> initPhaseStates() {
        List<PhaseState> states = new ArrayList<>();
        for (String p : PHASE_ORDER) {
            states.add(new PhaseState(p, PHASE_LABELS.get(p), ST_PENDING));
        }
        return states;
    }

    private List<PhaseState> toPhaseStates(Map<String, String> statusByPhase) {
        List<PhaseState> states = new ArrayList<>();
        for (String p : PHASE_ORDER) {
            states.add(new PhaseState(p, PHASE_LABELS.get(p), statusByPhase.getOrDefault(p, ST_PENDING)));
        }
        return states;
    }

    /** 拼接会话转录：role + 正文（含推理段），截断到上限。 */
    private String buildTranscript(List<ByaiMessageHotDto> messages) {
        StringBuilder sb = new StringBuilder();
        for (ByaiMessageHotDto msg : messages) {
            String text = messageText(msg);
            if (text.isEmpty()) {
                continue;
            }
            String role = msg.getRole() != null ? msg.getRole() : "";
            sb.append(role).append(": ").append(text).append("\n");
            if (sb.length() >= MAX_TRANSCRIPT_CHARS) {
                break;
            }
        }
        String result = sb.toString();
        return result.length() > MAX_TRANSCRIPT_CHARS ? result.substring(0, MAX_TRANSCRIPT_CHARS) : result;
    }

    /** 单条消息的可扫描文本：正文 + 推理段 + 工具调用日志，任意有值即拼接。 */
    private String messageText(ByaiMessageHotDto msg) {
        StringBuilder sb = new StringBuilder();
        appendIfPresent(sb, msg.getMessageContent());
        appendIfPresent(sb, msg.getInferLog());
        appendIfPresent(sb, msg.getCallLogs());
        return sb.toString();
    }

    private void appendIfPresent(StringBuilder sb, String v) {
        if (v != null && !v.isEmpty()) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(v);
        }
    }

    private String normalizePhase(String raw) {
        if (raw == null) {
            return null;
        }
        String key = raw.trim().toLowerCase();
        return PHASE_ORDER.contains(key) ? key : null;
    }

    private String normalizeStatus(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim().toLowerCase();
        if (ST_PENDING.equals(s) || ST_RUNNING.equals(s) || ST_DONE.equals(s) || ST_REJECTED.equals(s)) {
            return s;
        }
        return null;
    }

    /** 从模型文本中抽取 JSON 对象；容忍 markdown 代码块与前后噪声（同评分服务口径）。 */
    private JsonNode parseJson(String raw) {
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        int start = raw.indexOf('{');
        int end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            return null;
        }
        String json = raw.substring(start, end + 1);
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            log.warn("[DevloopPhase] JSON 解析失败: {}", json, e);
            return null;
        }
    }

    /** 环节进度快照：任务级 currentPhase/round + 各环节状态 + 打回记录。messageCount 供缓存失效判断。 */
    @Data
    public static class PhaseSnapshot {
        private String currentPhase;
        private int round;
        private List<PhaseState> phases;
        private List<Kickback> kickbacks;
        private String source;
        private int messageCount;
    }

    @Data
    public static class PhaseState {
        private String key;
        private String label;
        private String status;

        public PhaseState() {
        }

        public PhaseState(String key, String label, String status) {
            this.key = key;
            this.label = label;
            this.status = status;
        }
    }

    @Data
    public static class Kickback {
        private String from;
        private String to;
        private int round;
        private String reason;

        public Kickback() {
        }

        public Kickback(String from, String to, int round, String reason) {
            this.from = from;
            this.to = to;
            this.round = round;
            this.reason = reason;
        }
    }
}
