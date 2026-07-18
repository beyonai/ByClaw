package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 研发闭环需求评分服务。
 * 对扫描到的候选需求调用 LLM 按多维度打分，回写综合分、优先级与明细 JSON，供优先级排序与自动派生使用。
 */
@Slf4j
@Service
public class DevloopScoringService {

    private static final String SCORE_PROMPT_CODE = "DEVLOOP_REQUIREMENT_SCORE_PROMPT";

    // 各维度分值上限，用于裁剪模型越界输出，保证综合分口径稳定
    private static final int MAX_BUSINESS_VALUE = 30;
    private static final int MAX_USER_IMPACT = 20;
    private static final int MAX_URGENCY = 15;
    private static final int MAX_STRATEGY_FIT = 15;
    private static final int MAX_FEASIBILITY = 10;
    private static final int MAX_REUSE_VALUE = 10;
    private static final int MIN_RISK = -10;

    // 优先级档位：综合分 >=80 P0，>=60 P1，其余 P2
    private static final int PRIORITY_P0_MIN = 80;
    private static final int PRIORITY_P1_MIN = 60;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private AIService aiService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private ScanLogItemMapper scanLogItemMapper;

    /** 对一批需求逐条评分并回写；单条失败不影响其余。 */
    public void scoreItems(List<ScanLogItem> items) {
        if (items == null || items.isEmpty()) {
            return;
        }
        String template = byaiSystemConfigService.findByParamCode(SCORE_PROMPT_CODE);
        if (template == null || template.isEmpty()) {
            log.warn("[DevloopScore] 未配置评分提示词 {}，本批 {} 条需求跳过评分（分数为空）。"
                + "请在系统配置中添加该提示词。", SCORE_PROMPT_CODE, items.size());
            return;
        }
        for (ScanLogItem item : items) {
            try {
                scoreOne(item, template);
            } catch (Exception e) {
                // 配置类错误（如未配置默认 LLM 模型）整批都会失败，单独给出可操作提示且不刷全堆栈；
                // 其余为单条运行时异常，打印堆栈便于定位。
                String hint = configErrorHint(e);
                if (hint != null) {
                    log.error("[DevloopScore] 评分中止：{} 本批剩余需求分数将为空。item={}", hint, item.getItemId());
                    return;
                }
                log.error("[DevloopScore] 评分失败, item={}", item.getItemId(), e);
            }
        }
    }

    /**
     * 识别「配置缺失」类错误并给出可操作提示；非配置错误返回 null（走原始堆栈日志）。
     * 这类错误对整批需求都会复现，逐条打全堆栈会淹没日志，故在此归一化为一句话提示并中止本批。
     */
    private String configErrorHint(Exception e) {
        String msg = rootMessage(e);
        if (msg == null) {
            return null;
        }
        if (msg.contains("chat_model.not.configured") || msg.contains("no.default.model")
            || msg.contains("no default model")) {
            return "未配置默认聊天(LLM)模型。请在「模型管理」将一个可用 LLM 模型设为默认（打默认标签）。";
        }
        if (msg.contains("api.call.failed") || msg.contains("api.request.failed")) {
            return "调用大模型接口失败（可能是 token 失效/额度不足/网络不通）：" + msg;
        }
        return null;
    }

    private String rootMessage(Throwable e) {
        Throwable cur = e;
        String msg = e.getMessage();
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
            if (cur.getMessage() != null) {
                msg = cur.getMessage();
            }
        }
        return msg;
    }

    /** 对单条需求评分并回写 score/priority/scoreDetail。 */
    private void scoreOne(ScanLogItem item, String template) {
        String content = item.getContent() != null ? item.getContent() : "";
        String userPrompt = template
            .replace("${title}", item.getTitle() != null ? item.getTitle() : "")
            .replace("${content}", content);

        String raw = aiService.generateText(null, userPrompt, null, 800);
        JsonNode node = parseScoreJson(raw);
        if (node == null) {
            log.warn("[DevloopScore] 模型返回无法解析为评分JSON, item={}", item.getItemId());
            return;
        }

        int businessValue = clamp(node.path("businessValue").asInt(0), 0, MAX_BUSINESS_VALUE);
        int userImpact = clamp(node.path("userImpact").asInt(0), 0, MAX_USER_IMPACT);
        int urgency = clamp(node.path("urgency").asInt(0), 0, MAX_URGENCY);
        int strategyFit = clamp(node.path("strategyFit").asInt(0), 0, MAX_STRATEGY_FIT);
        int feasibility = clamp(node.path("feasibility").asInt(0), 0, MAX_FEASIBILITY);
        int reuseValue = clamp(node.path("reuseValue").asInt(0), 0, MAX_REUSE_VALUE);
        int risk = clamp(node.path("risk").asInt(0), MIN_RISK, 0);
        String summary = node.path("summary").asText("");

        int score = businessValue + userImpact + urgency + strategyFit + feasibility + reuseValue + risk;
        score = clamp(score, 0, 100);
        String priority = score >= PRIORITY_P0_MIN ? "P0" : (score >= PRIORITY_P1_MIN ? "P1" : "P2");

        // 明细固化裁剪后的分值，避免前端展示与综合分口径不一致
        ObjectNode detail = MAPPER.createObjectNode();
        detail.put("businessValue", businessValue);
        detail.put("userImpact", userImpact);
        detail.put("urgency", urgency);
        detail.put("strategyFit", strategyFit);
        detail.put("feasibility", feasibility);
        detail.put("reuseValue", reuseValue);
        detail.put("risk", risk);
        detail.put("summary", summary);

        ScanLogItem update = new ScanLogItem();
        update.setItemId(item.getItemId());
        update.setScore(score);
        update.setPriority(priority);
        update.setScoreDetail(detail.toString());
        scanLogItemMapper.updateById(update);

        // 回填内存对象，供扫描流程后续（如 score 模式自动派生）直接读取，避免再查库
        item.setScore(score);
        item.setPriority(priority);
        item.setScoreDetail(detail.toString());
    }

    /** 从模型文本中抽取 JSON 对象；容忍 markdown 代码块与前后噪声。 */
    private JsonNode parseScoreJson(String raw) {
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
            log.warn("[DevloopScore] JSON 解析失败: {}", json, e);
            return null;
        }
    }

    private int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
