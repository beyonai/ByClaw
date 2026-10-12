package com.iwhalecloud.byai.manager.application.runner;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelProtocol;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelStatusEnum;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ModelConfigurationValidator;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 启动时用 .env 中的可用模型信息，更新仍为“请用户替换”的预置 LLM（-2000）和 Embedding（-2001）。
 * 只更新模型编号、模型名称、地址、Token 及上下文、maxTokens、维度和批大小，并把状态改为启用。
 * 模型名称与模型编码相同。地址只保存到 /v1，调用时再补 /chat/completions 或 /embeddings。
 * LLM 的 model_protocol 为空时写成 OpenAI。
 * 上下文长度默认 128000，maxTokens 和 Embedding 维度默认 1024，写在 @Value 和 application.properties。
 * 已配置过的记录保持不变。启用后沿用模型更新逻辑同步 Redis，且早于 Redis 模型缓存加载执行。
 * 查询、加密、写库或同步 Redis 失败时只记日志，不中断启动。
 */
@Component
@Order(0)
public class InitBuiltinAiModelRunner implements ApplicationRunner {

    private static final Logger LOGGER = LoggerFactory.getLogger(InitBuiltinAiModelRunner.class);

    private static final long LLM_MODEL_ID = -2000L;

    private static final long EMBEDDING_MODEL_ID = -2001L;

    private static final String PLACEHOLDER = "请用户替换";

    @Value("${byclaw.init.llm.model-no:}")
    private String llmModelNo;

    @Value("${byclaw.init.llm.url:}")
    private String llmUrl;

    @Value("${byclaw.init.llm.api-token:}")
    private String llmApiToken;

    @Value("${byclaw.init.llm.max-content-token:128000}")
    private String llmMaxContentToken;

    @Value("${byclaw.init.llm.max-tokens:1024}")
    private String llmMaxTokens;

    @Value("${byclaw.init.embedding.model-no:}")
    private String embeddingModelNo;

    @Value("${byclaw.init.embedding.url:}")
    private String embeddingUrl;

    @Value("${byclaw.init.embedding.api-token:}")
    private String embeddingApiToken;

    @Value("${byclaw.init.embedding.max-content-token:128000}")
    private String embeddingMaxContentToken;

    @Value("${byclaw.init.embedding.max-tokens:1024}")
    private String embeddingMaxTokens;

    @Value("${byclaw.init.embedding.dimensions:1024}")
    private String embeddingDimensions;

    @Value("${byclaw.init.embedding.max-batch-size:}")
    private String embeddingMaxBatchSize;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    /**
     * 分别尝试用环境变量更新预置 LLM 与 Embedding。失败只记日志，不中断启动。
     *
     * @param args 启动参数，本初始化不使用
     */
    @Override
    public void run(ApplicationArguments args) {
        try {
            apply(LLM_MODEL_ID, llmModelNo, llmUrl, llmApiToken, llmMaxContentToken, llmMaxTokens, null, null);
            apply(EMBEDDING_MODEL_ID, embeddingModelNo, embeddingUrl, embeddingApiToken, embeddingMaxContentToken,
                embeddingMaxTokens, embeddingDimensions, embeddingMaxBatchSize);
        } catch (Exception ex) {
            LOGGER.error("用环境变量更新预置模型失败，系统继续启动", ex);
        }
    }

    /**
     * 记录仍是占位值且环境变量可用时，加密 Token、把状态改为启用后按模型更新逻辑写库，并同步到 Redis。
     *
     * @param modelId 预置模型主键，-2000 或 -2001
     * @param modelNo 模型编号
     * @param url API 地址
     * @param apiToken API Token
     * @param maxContentToken 上下文长度
     * @param maxTokens 单次生成上限
     * @param dimensions Embedding 维度，LLM 不传
     * @param maxBatchSize Embedding 批大小，空白则不改
     */
    private void apply(long modelId, String modelNo, String url, String apiToken, String maxContentToken,
        String maxTokens, String dimensions, String maxBatchSize) {
        ByaiAimodel existing = byaiAimodelDomainService.getById(modelId);
        if (existing == null) {
            LOGGER.info("预置模型不存在，跳过环境变量初始化, modelId={}", modelId);
            return;
        }
        if (!isPlaceholderRecord(existing)) {
            LOGGER.info("预置模型已配置，跳过环境变量初始化, modelId={}", modelId);
            return;
        }
        if (!isUsable(modelNo, url, apiToken, maxContentToken, maxTokens, dimensions, maxBatchSize)) {
            LOGGER.info("预置模型仍为占位配置，环境变量未提供可用的模型信息，跳过更新, modelId={}", modelId);
            return;
        }
        copyEnv(existing, modelNo, url, apiToken, maxContentToken, maxTokens, dimensions, maxBatchSize);
        existing.setAuthToken(Sm4Util.encrypt(existing.getAuthToken()));
        // 已有主键走更新；启用状态（OOA）在 upsert 内同步 Redis
        byaiAimodelDomainService.upsert(existing);
        LOGGER.info("已用环境变量更新预置模型, modelId={}, modelNo={}", modelId, existing.getModelNo());
    }

    /**
     * 地址、Token 或模型编号仍包含“请用户替换”时，认为这条预置模型还没被人工配置过。
     *
     * @param model 数据库中的预置模型
     * @return 仍是初始化占位时返回 true
     */
    private static boolean isPlaceholderRecord(ByaiAimodel model) {
        return containsPlaceholder(model.getUrl()) || containsPlaceholder(model.getAuthToken())
            || containsPlaceholder(model.getModelNo());
    }

    /**
     * 校验模型编号、地址和 Token，并要求已填写的上下文长度、维度、批大小为正整数。
     *
     * @param modelNo 模型编号
     * @param url API 地址
     * @param apiToken API Token
     * @param maxContentToken 上下文长度
     * @param maxTokens 单次生成上限
     * @param dimensions Embedding 维度，LLM 为空
     * @param maxBatchSize Embedding 批大小，可空
     * @return 可以写回数据库时返回 true
     */
    private static boolean isUsable(String modelNo, String url, String apiToken, String maxContentToken,
        String maxTokens, String dimensions, String maxBatchSize) {
        if (!optionalPositive(maxContentToken) || !optionalPositive(maxTokens) || !optionalPositive(dimensions)
            || !optionalPositive(maxBatchSize)) {
            return false;
        }
        ModelDto dto = new ModelDto();
        dto.setUrl(trimToEmpty(url));
        dto.setAuthToken(trimToEmpty(apiToken));
        dto.setModelCode(trimToEmpty(modelNo));
        try {
            ModelConfigurationValidator.validate(dto);
            return true;
        } catch (ModelConfigurationValidator.InvalidModelConfigurationException ex) {
            LOGGER.error("预置模型环境变量未通过可用性校验, modelNo={}", trimToEmpty(modelNo), ex);
            return false;
        }
    }

    /**
     * 把环境变量中的编号、名称、地址、Token、上下文长度和 maxTokens 写到实体上，状态改为启用。
     * 模型名称与模型编码相同。地址截到 /v1。LLM 的 model_protocol 为空时写成 OpenAI。Token 此时仍是明文，由调用方加密。
     *
     * @param model 待更新的预置模型
     * @param modelNo 模型编号
     * @param url API 地址
     * @param apiToken API Token
     * @param maxContentToken 上下文长度
     * @param maxTokens 单次生成上限
     * @param dimensions Embedding 维度，LLM 不传
     * @param maxBatchSize Embedding 批大小，空白则不改
     */
    private static void copyEnv(ByaiAimodel model, String modelNo, String url, String apiToken, String maxContentToken,
        String maxTokens, String dimensions, String maxBatchSize) {
        String modelCode = trimToEmpty(modelNo);
        model.setModelNo(modelCode);
        model.setModelName(modelCode);
        model.setUrl(toBaseUrl(url));
        model.setAuthToken(trimToEmpty(apiToken));
        model.setStatus(ModelStatusEnum.ENABLED.getDbCode());
        if ("LLM".equalsIgnoreCase(model.getModelType()) && StringUtils.isBlank(model.getModelProtocol())) {
            model.setModelProtocol(ModelProtocol.OPEN_AI);
        }
        model.setMaxContentToken(parsePositive(maxContentToken));
        applyInParams(model, maxTokens, dimensions, maxBatchSize);
    }

    /**
     * 在保留原有 in_params 的前提下写入 maxTokens、Embedding 维度、批大小和更新时间。原 JSON 无法解析时新建对象。
     *
     * @param model 待更新的预置模型
     * @param maxTokens 单次生成上限
     * @param dimensions Embedding 维度，空白则不改
     * @param maxBatchSize Embedding 批大小，空白则不改
     */
    private static void applyInParams(ByaiAimodel model, String maxTokens, String dimensions, String maxBatchSize) {
        JSONObject inParams = parseInParams(model.getInParams());
        Integer parsedDimensions = parsePositive(dimensions);
        Integer parsedMaxBatchSize = parsePositive(maxBatchSize);
        if (inParams == null) {
            inParams = new JSONObject();
        }
        inParams.put("maxTokens", parsePositive(maxTokens));
        if (parsedDimensions != null) {
            inParams.put("dimensions", parsedDimensions);
        }
        if (parsedMaxBatchSize != null) {
            inParams.put("maxBatchSize", parsedMaxBatchSize);
        }
        inParams.put("updatedAt", Instant.now().truncatedTo(ChronoUnit.SECONDS).toString());
        model.setInParams(inParams.toJSONString());
    }

    /**
     * 解析 in_params。空白或不是合法 JSON 时返回 null，避免用空对象覆盖已有配置。
     *
     * @param inParams 库中的 in_params
     * @return 解析结果，无法解析时返回 null
     */
    private static JSONObject parseInParams(String inParams) {
        if (StringUtils.isBlank(inParams)) {
            return null;
        }
        try {
            return JSONObject.parseObject(inParams);
        } catch (RuntimeException ex) {
            LOGGER.error("预置模型 in_params 不是合法 JSON", ex);
            return null;
        }
    }

    /**
     * 判断字段值是否仍包含初始化占位文案。
     *
     * @param value 地址、Token 或模型编号
     * @return 包含“请用户替换”时返回 true
     */
    private static boolean containsPlaceholder(String value) {
        return value != null && value.contains(PLACEHOLDER);
    }

    /**
     * 可选数值未填写时视为通过；填写了则必须是正整数。
     *
     * @param raw 环境变量原始值
     * @return 空白或正整数时返回 true
     */
    private static boolean optionalPositive(String raw) {
        return StringUtils.isBlank(raw) || parsePositive(raw) != null;
    }

    /**
     * 将环境变量解析为正整数。空白、非数字或小于等于 0 时返回 null。
     *
     * @param raw 环境变量原始值
     * @return 正整数，无法使用时返回 null
     */
    private static Integer parsePositive(String raw) {
        if (StringUtils.isBlank(raw)) {
            return null;
        }
        try {
            int value = Integer.parseInt(raw.trim());
            return value > 0 ? value : null;
        } catch (NumberFormatException ex) {
            LOGGER.error("预置模型数值配置不是正整数, value={}", raw, ex);
            return null;
        }
    }

    /**
     * 把地址收成 OpenAI 兼容基础地址。路径里出现 /v1 时只保留到该段，
     * 因此 https://api.example.com/v1/chat/completions 和 https://api.example.com/v1/embeddings
     * 都会写成 https://api.example.com/v1。没有 /v1 时去掉末尾的 /chat/completions 或 /embeddings。
     *
     * @param raw 环境变量中的地址
     * @return 写入数据库的基础地址
     */
    private static String toBaseUrl(String raw) {
        String url = trimToEmpty(raw);
        if (url.isEmpty()) {
            return url;
        }
        int query = url.indexOf('?');
        if (query >= 0) {
            url = url.substring(0, query);
        }
        int fragment = url.indexOf('#');
        if (fragment >= 0) {
            url = url.substring(0, fragment);
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        String lower = url.toLowerCase(Locale.ROOT);
        int v1 = indexOfV1Segment(lower);
        if (v1 >= 0) {
            return url.substring(0, v1 + "/v1".length());
        }
        String stripped = stripSuffix(url, lower, "/chat/completions");
        if (stripped != null) {
            return stripped;
        }
        stripped = stripSuffix(url, lower, "/embeddings");
        return stripped == null ? url : stripped;
    }

    /**
     * 查找路径中的 /v1 段。/v10 这类前缀不算。
     *
     * @param lowerUrl 已转成小写的地址
     * @return /v1 的起始下标，没有时返回 -1
     */
    private static int indexOfV1Segment(String lowerUrl) {
        int from = 0;
        while (from < lowerUrl.length()) {
            int index = lowerUrl.indexOf("/v1", from);
            if (index < 0) {
                return -1;
            }
            int end = index + "/v1".length();
            if (end == lowerUrl.length() || lowerUrl.charAt(end) == '/') {
                return index;
            }
            from = end;
        }
        return -1;
    }

    /**
     * 去掉指定结尾。大小写不敏感，去掉后不保留末尾斜杠。
     *
     * @param url 原始地址
     * @param lowerUrl 小写地址
     * @param suffix 要去掉的结尾
     * @return 去掉后的地址，结尾不匹配时返回 null
     */
    private static String stripSuffix(String url, String lowerUrl, String suffix) {
        if (!lowerUrl.endsWith(suffix)) {
            return null;
        }
        String stripped = url.substring(0, url.length() - suffix.length());
        while (stripped.endsWith("/")) {
            stripped = stripped.substring(0, stripped.length() - 1);
        }
        return stripped;
    }

    /**
     * 去掉首尾空白。null 按空字符串处理，避免后续校验出现空指针。
     *
     * @param value 原始字符串
     * @return 去掉首尾空白后的字符串
     */
    private static String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
