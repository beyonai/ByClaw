package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 研发闭环需求「拆分 + 评分」服务。
 * 一次 LLM 调用完成两件事：把一条消息里耦合的多个独立需求拆开，并对每个子需求多维度打分。
 * 拆出多条时原始条标记 action=split（不派发），为每个子需求落一条 item（parent_item_id 溯源）；
 * 只拆出一条时原地更新原 item。返回供派发的 item 列表（子需求 + 未拆分条，不含被拆分的原始条）。
 */
@Slf4j
@Service
public class DevloopScoringService {

    // 拆分+评分合并提示词；缺失时回退纯评分提示词，保证仍能评分（不拆分）
    private static final String SPLIT_SCORE_PROMPT_CODE = "DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT";

    private static final String SCORE_PROMPT_CODE = "DEVLOOP_REQUIREMENT_SCORE_PROMPT";

    // 单条消息最多拆出的子需求数，超出保留原条不拆，防止模型过度拆分刷爆任务
    private static final int MAX_SPLIT = 5;

    // 拆分产生的原始条动作：不进需求列表(listCreatedItemsBySource 只取 created)、不派发
    private static final String ACTION_SPLIT = "split";

    private static final String DEDUP_NORMAL = "normal";

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
    private ScanRequireItemMapper scanRequireItemMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 对一批扫描到的原始需求逐条「拆分 + 评分」，返回供派发的 item 列表。
     * 单条失败不影响其余；配置类错误（如未配置默认 LLM 模型）整批中止并给可操作提示。
     * 返回列表 = 各原始条的处理结果：拆分则为子需求们，未拆分则为原条本身（已回写分数）。
     */
    public List<ScanRequireItem> splitAndScore(List<ScanRequireItem> items) {
        List<ScanRequireItem> dispatchList = new ArrayList<>();
        if (items == null || items.isEmpty()) {
            return dispatchList;
        }
        // 优先用「拆分+评分」合并提示词；缺失回退纯评分提示词（此时不拆分，仅评分）
        String template = byaiSystemConfigService.findByParamCode(SPLIT_SCORE_PROMPT_CODE);
        boolean splitEnabled = template != null && !template.isEmpty();
        if (!splitEnabled) {
            template = byaiSystemConfigService.findByParamCode(SCORE_PROMPT_CODE);
        }
        if (template == null || template.isEmpty()) {
            log.warn("[DevloopScore] 未配置拆分/评分提示词，本批 {} 条需求跳过（分数为空、不拆分）。", items.size());
            return new ArrayList<>(items);
        }
        for (ScanRequireItem item : items) {
            try {
                dispatchList.addAll(splitAndScoreOne(item, template, splitEnabled));
            } catch (Exception e) {
                String hint = configErrorHint(e);
                if (hint != null) {
                    log.error("[DevloopScore] 处理中止：{} 本批剩余需求将不评分/不拆分。item={}", hint, item.getItemId());
                    // 中止：剩余未处理的原条按原样进入派发列表，避免漏派
                    for (ScanRequireItem rest : items) {
                        if (!dispatchList.contains(rest) && rest.getSessionId() == null) {
                            dispatchList.add(rest);
                        }
                    }
                    return dispatchList;
                }
                log.error("[DevloopScore] 拆分/评分失败, item={}", item.getItemId(), e);
                // 单条失败：原条按原样进入派发列表
                dispatchList.add(item);
            }
        }
        return dispatchList;
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
            return I18nUtil.get("devloop.scoring.default.model.not.configured");
        }
        if (msg.contains("api.call.failed") || msg.contains("api.request.failed")) {
            return I18nUtil.get("devloop.scoring.model.call.failed", msg);
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

    /**
     * 单条原始需求：一次 LLM 调用拆分+评分。返回本条对应的派发 item 列表。
     * 模型返回 requirements 数组：仅 1 条=不拆分，原地更新原条；多条=原条标 split(不派发)，为每条子需求落新 item。
     */
    private List<ScanRequireItem> splitAndScoreOne(ScanRequireItem item, String template, boolean splitEnabled) {
        String content = item.getContent() != null ? item.getContent() : "";
        String userPrompt = template.replace("${title}", item.getTitle() != null ? item.getTitle() : "")
            .replace("${content}", content);

        String raw = aiService.generateText(null, userPrompt, (String) null, 1500);
        JsonNode node = parseScoreJson(raw);
        List<ScanRequireItem> out = new ArrayList<>();
        if (node == null) {
            log.warn("[DevloopScore] 模型返回无法解析, item={}，按原条不拆分不评分处理", item.getItemId());
            out.add(item);
            return out;
        }

        // 拆分+评分提示词返回 requirements 数组；纯评分提示词返回单个评分对象(无 requirements)
        JsonNode reqs = node.path("requirements");
        List<JsonNode> subs = new ArrayList<>();
        if (reqs.isArray() && reqs.size() > 0) {
            reqs.forEach(subs::add);
        } else {
            subs.add(node); // 兼容纯评分：整个对象当作单个需求的评分
        }

        boolean doSplit = splitEnabled && subs.size() > 1;
        if (doSplit && subs.size() > MAX_SPLIT) {
            // 过度拆分：放弃拆分，退化为对原条整体评分，避免刷爆任务
            log.warn("[DevloopScore] item={} 拆出 {} 条超上限 {}，退化为不拆分整体评分", item.getItemId(), subs.size(),
                MAX_SPLIT);
            doSplit = false;
            subs = subs.subList(0, 1);
        }

        if (!doSplit) {
            // 不拆分：原地把评分回写到原 item
            applyScore(item, subs.get(0), false, null, null, null);
            out.add(item);
            return out;
        }

        // 拆分：原条标记 split（不进列表、不派发），为每个子需求落新 item
        ScanRequireItem markSplit = new ScanRequireItem();
        markSplit.setItemId(item.getItemId());
        markSplit.setAction(ACTION_SPLIT);
        scanRequireItemMapper.updateById(markSplit);

        for (JsonNode sub : subs) {
            ScanRequireItem child = new ScanRequireItem();
            child.setItemId(sequenceService.nextVal());
            child.setLogId(item.getLogId());
            child.setSourceId(item.getSourceId());
            String subTitle = sub.path("title").asText("");
            String subContent = sub.path("content").asText("");
            child.setTitle(!subTitle.isEmpty() ? subTitle : item.getTitle());
            child.setContent(!subContent.isEmpty() ? subContent : content);
            child.setOriginId(item.getOriginId());
            child.setOriginUrl(item.getOriginUrl());
            child.setAction("created");
            child.setParentItemId(item.getItemId());
            child.setDedupStatus(DEDUP_NORMAL);
            applyScore(child, sub, true, item.getLogId(), item.getSourceId(), item.getItemId());
            out.add(child);
        }
        log.info("[DevloopScore] item={} 拆分为 {} 个子需求", item.getItemId(), subs.size());
        return out;
    }

    /**
     * 计算评分并写入 item：isNew=true 走 insert（子需求新建），false 走 update（原条回写）。
     * 无论新旧都回填内存对象，供后续 score 模式派生直接读取。
     */
    private void applyScore(ScanRequireItem target, JsonNode node, boolean isNew, Long logId, Long sourceId,
        Long parentId) {
        int businessValue = clamp(node.path("businessValue").asInt(0), 0, MAX_BUSINESS_VALUE);
        int userImpact = clamp(node.path("userImpact").asInt(0), 0, MAX_USER_IMPACT);
        int urgency = clamp(node.path("urgency").asInt(0), 0, MAX_URGENCY);
        int strategyFit = clamp(node.path("strategyFit").asInt(0), 0, MAX_STRATEGY_FIT);
        int feasibility = clamp(node.path("feasibility").asInt(0), 0, MAX_FEASIBILITY);
        int reuseValue = clamp(node.path("reuseValue").asInt(0), 0, MAX_REUSE_VALUE);
        int risk = clamp(node.path("risk").asInt(0), MIN_RISK, 0);
        String summary = node.path("summary").asText("");

        int score = clamp(businessValue + userImpact + urgency + strategyFit + feasibility + reuseValue + risk, 0, 100);
        String priority = score >= PRIORITY_P0_MIN ? "P0" : (score >= PRIORITY_P1_MIN ? "P1" : "P2");

        ObjectNode detail = MAPPER.createObjectNode();
        detail.put("businessValue", businessValue);
        detail.put("userImpact", userImpact);
        detail.put("urgency", urgency);
        detail.put("strategyFit", strategyFit);
        detail.put("feasibility", feasibility);
        detail.put("reuseValue", reuseValue);
        detail.put("risk", risk);
        detail.put("summary", summary);
        String detailJson = detail.toString();

        // 回填内存对象（新条已在调用处 set 好其它字段）
        target.setScore(score);
        target.setPriority(priority);
        target.setScoreDetail(detailJson);

        if (isNew) {
            scanRequireItemMapper.insert(target);
        } else {
            ScanRequireItem update = new ScanRequireItem();
            update.setItemId(target.getItemId());
            update.setScore(score);
            update.setPriority(priority);
            update.setScoreDetail(detailJson);
            scanRequireItemMapper.updateById(update);
        }
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
