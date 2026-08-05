package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.message.qo.MessageQo;
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
 * 解析数字员工按约定输出的 [PHASE] 打点标记（零成本、可靠、天然支持打回），
 * 无打点标记时返回全未开始。产出 7 环节进度快照，供任务详情逐环节展示。
 */
@Slf4j
@Service
public class DevloopPhaseService {

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

    // 派生来源：打点标记 / 无信号（全未开始）
    private static final String SRC_MARKER = "marker";
    private static final String SRC_EMPTY = "empty";

    // 只解析数字员工的回答(usage=SYSTEM_RESPONSE)。用户输入(usage=USER_INPUT，含任务启动提示词里的
    // [PHASE] 示例标记)必须跳过，否则提示词中的示例会被当成真实进展，导致任务一启动就误判到 coder 阶段。
    // 判别用 byai_message.usage 而非 role：系统里问答同为 agent-user 角色，仅靠 usage 区分输入/回答。
    private static final int USAGE_SYSTEM_RESPONSE = 2;

    // 一个任务的完整对话回看上限，够覆盖多轮打回即可，避免超长会话拖慢解析
    private static final int MAX_MESSAGES = 100;

    /**
     * 打点标记：[PHASE] &lt;环节&gt; &lt;START|DONE|REJECT[-&gt;目标环节]&gt; [原因...]
     * 例：[PHASE] coder START   /   [PHASE] tester REJECT->coder 原因:单测未覆盖审计日志
     */
    private static final Pattern MARKER = Pattern.compile(
        "\\[PHASE\\]\\s*([A-Za-z]+)\\s+(START|DONE|REJECT)(?:\\s*-+>\\s*([A-Za-z]+))?(?:[\\s:：]+(.*))?",
        Pattern.CASE_INSENSITIVE);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /** 计算某会话(任务)的环节进度快照：有 [PHASE] 打点标记按标记派生，无标记返回全未开始。 */
    public PhaseSnapshot buildSnapshot(Long sessionId) {
        List<ByaiMessageHotDto> messages = loadMessagesAscending(sessionId);
        int messageCount = messages.size();

        PhaseSnapshot byMarker = parseByMarkers(messages);
        if (byMarker != null) {
            byMarker.setMessageCount(messageCount);
            return byMarker;
        }
        PhaseSnapshot empty = emptySnapshot();
        empty.setMessageCount(messageCount);
        return empty;
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
        // 只保留数字员工回答(usage=SYSTEM_RESPONSE)：任务启动提示词是用户输入且含 [PHASE] 示例标记，
        // 参与解析会污染进展判定，导致任务一启动就误判到 coder 阶段。
        List<ByaiMessageHotDto> asc = new ArrayList<>();
        for (ByaiMessageHotDto msg : messages) {
            Integer usage = msg.getUsage();
            if (usage != null && usage == USAGE_SYSTEM_RESPONSE) {
                asc.add(msg);
            }
        }
        java.util.Collections.reverse(asc);
        return asc;
    }

    /**
     * 打点解析：按对话顺序处理每条 [PHASE] 标记，维护各环节状态、轮次与打回记录。
     * 无任何标记时返回 null，由调用方给出全未开始快照。
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

    /**
     * 单条消息的可扫描文本：只取正文 messageContent。
     * 不含 inferLog/callLogs（推理段与工具调用日志，如 git clone/exec 输出），
     * 那些内容会把准备动作误判成编码环节，且 [PHASE] 汇报标记本就应在正文里。
     */
    private String messageText(ByaiMessageHotDto msg) {
        String content = msg.getMessageContent();
        return content != null ? content : "";
    }

    private String normalizePhase(String raw) {
        if (raw == null) {
            return null;
        }
        String key = raw.trim().toLowerCase();
        return PHASE_ORDER.contains(key) ? key : null;
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
