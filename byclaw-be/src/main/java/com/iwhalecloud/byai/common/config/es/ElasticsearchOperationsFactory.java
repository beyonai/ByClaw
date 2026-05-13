package com.iwhalecloud.byai.common.config.es;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import lombok.extern.slf4j.Slf4j;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Elasticsearch操作工厂类
 * 统一使用Elasticsearch 8版本
 * 支持多实例管理，根据连接参数生成唯一实例
 *
 * @author system
 */
@Slf4j
public class ElasticsearchOperationsFactory {

    /**
     * ES操作实例缓存，key为连接参数的MD5值，value为对应的操作实例
     */
    private static final Map<String, ElasticsearchOperations> OPERATIONS_CACHE = new ConcurrentHashMap<>();

    /**
     * 私有化构造器，防止实例化
     */
    private ElasticsearchOperationsFactory() {
        // 工具类不允许实例化
    }

    /**
     * 获取ES操作实例（统一使用ES8版本）
     * 根据连接参数生成唯一key，相同参数的连接会复用同一个实例
     *
     * @param hosts    ES主机地址，多个用逗号分隔，不能为空
     * @param username 用户名，可以为空（无认证场景）
     * @param password 密码，可以为空（无认证场景）
     * @return ES操作实例
     * @throws BaseException 当参数校验失败或创建实例失败时抛出
     */
    public static ElasticsearchOperations getOperations(String hosts, String username, String password) {
        // 参数校验
        validateParams(hosts, username, password);

        // 生成唯一key，用于缓存实例
        String cacheKey = generateCacheKey(hosts, username, password);

        // 双重检查锁定模式，确保线程安全
        ElasticsearchOperations operations = OPERATIONS_CACHE.get(cacheKey);
        if (operations == null) {
            synchronized (ElasticsearchOperationsFactory.class) {
                operations = OPERATIONS_CACHE.get(cacheKey);
                if (operations == null) {
                    try {
                        log.info("创建新的Elasticsearch操作实例，hosts: {}", maskSensitiveInfo(hosts));
                        operations = new Elasticsearch8Operations(hosts, username, password);
                        OPERATIONS_CACHE.put(cacheKey, operations);
                        log.info("Elasticsearch操作实例创建成功，cacheKey: {}", cacheKey);
                    } catch (Exception e) {
                        log.error("创建Elasticsearch操作实例失败，hosts: {}", maskSensitiveInfo(hosts), e);
                        String errorMsg = getI18nMessage("elasticsearch.operations.create.failed", 
                                "创建Elasticsearch操作实例失败", maskSensitiveInfo(hosts));
                        throw new BaseException(errorMsg, e);
                    }
                }
            }
        }
        return operations;
    }

    /**
     * 关闭指定连接参数的ES连接
     *
     * @param hosts    ES主机地址，多个用逗号分隔
     * @param username 用户名
     * @param password 密码
     */
    public static void close(String hosts, String username, String password) {
        if (StringUtil.isEmpty(hosts)) {
            log.warn("关闭ES连接时，hosts参数为空，跳过操作");
            return;
        }

        String cacheKey = generateCacheKey(hosts, username, password);
        ElasticsearchOperations operations = OPERATIONS_CACHE.remove(cacheKey);
        if (operations != null) {
            try {
                if (operations instanceof Elasticsearch8Operations) {
                    ((Elasticsearch8Operations) operations).close();
                    log.info("成功关闭Elasticsearch连接，cacheKey: {}", cacheKey);
                }
            } catch (Exception e) {
                log.error("关闭Elasticsearch连接时发生异常，cacheKey: {}", cacheKey, e);
            }
        }
    }

    /**
     * 关闭所有ES连接
     * 线程安全方法，使用同步块确保并发安全
     */
    public static void closeAll() {
        synchronized (ElasticsearchOperationsFactory.class) {
            if (OPERATIONS_CACHE.isEmpty()) {
                log.debug("ES连接缓存为空，无需关闭");
                return;
            }

            log.info("开始关闭所有Elasticsearch连接，连接数: {}", OPERATIONS_CACHE.size());
            int successCount = 0;
            int failCount = 0;

            for (Map.Entry<String, ElasticsearchOperations> entry : OPERATIONS_CACHE.entrySet()) {
                String cacheKey = entry.getKey();
                ElasticsearchOperations operations = entry.getValue();
                try {
                    if (operations instanceof Elasticsearch8Operations) {
                        ((Elasticsearch8Operations) operations).close();
                        successCount++;
                        log.debug("成功关闭Elasticsearch连接，cacheKey: {}", cacheKey);
                    }
                } catch (Exception e) {
                    failCount++;
                    log.error("关闭Elasticsearch连接时发生异常，cacheKey: {}", cacheKey, e);
                }
            }

            // 清空缓存
            OPERATIONS_CACHE.clear();
            log.info("所有Elasticsearch连接关闭完成，成功: {}, 失败: {}", successCount, failCount);
        }
    }

    /**
     * 获取当前缓存的连接数量
     *
     * @return 连接数量
     */
    public static int getConnectionCount() {
        return OPERATIONS_CACHE.size();
    }

    /**
     * 校验输入参数
     *
     * @param hosts    ES主机地址
     * @param username 用户名
     * @param password 密码
     * @throws BaseException 当参数校验失败时抛出
     */
    private static void validateParams(String hosts, String username, String password) {
        // 校验hosts参数不能为空
        if (StringUtil.isEmpty(hosts)) {
            String errorMsg = getI18nMessage("elasticsearch.operations.hosts.empty", 
                    "Elasticsearch主机地址不能为空");
            log.error("Elasticsearch连接参数校验失败: hosts为空");
            throw new BaseException(errorMsg);
        }

        // 校验hosts格式（简单校验，至少包含一个有效的主机地址）
        String trimmedHosts = hosts.trim();
        if (trimmedHosts.isEmpty()) {
            String errorMsg = getI18nMessage("elasticsearch.operations.hosts.empty", 
                    "Elasticsearch主机地址不能为空");
            log.error("Elasticsearch连接参数校验失败: hosts为空字符串");
            throw new BaseException(errorMsg);
        }

        // 如果提供了用户名，则密码也应该提供（安全规范要求）
        if (StringUtil.isNotEmpty(username) && StringUtil.isEmpty(password)) {
            String errorMsg = getI18nMessage("elasticsearch.operations.password.required", 
                    "提供用户名时必须提供密码");
            log.error("Elasticsearch连接参数校验失败: 提供了用户名但密码为空");
            throw new BaseException(errorMsg);
        }

        log.debug("Elasticsearch连接参数校验通过");
    }

    /**
     * 安全获取国际化消息
     * 如果国际化获取失败，则返回默认的中文消息
     *
     * @param key          国际化key
     * @param defaultMsg   默认消息（中文）
     * @param args         参数
     * @return 国际化消息或默认消息
     */
    private static String getI18nMessage(String key, String defaultMsg, Object... args) {
        try {
            String message = I18nUtil.get(key, args);
            // 如果返回的是key本身（表示未找到），则使用默认消息
            if (key.equals(message)) {
                return defaultMsg;
            }
            return message;
        } catch (Exception e) {
            log.warn("获取国际化消息失败，使用默认消息。key: {}, error: {}", key, e.getMessage());
            return defaultMsg;
        }
    }

    /**
     * 根据连接参数生成唯一缓存key
     * 使用MD5算法生成，确保相同参数生成相同key
     *
     * @param hosts    ES主机地址
     * @param username 用户名
     * @param password 密码
     * @return MD5哈希值作为缓存key
     */
    private static String generateCacheKey(String hosts, String username, String password) {
        // 构建唯一标识字符串
        String keySource = String.format("%s|%s|%s", 
                hosts != null ? hosts.trim() : "",
                username != null ? username : "",
                password != null ? password : "");

        try {
            // 使用MD5算法生成唯一key
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] hashBytes = md.digest(keySource.getBytes(StandardCharsets.UTF_8));
            
            // 转换为十六进制字符串
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // MD5算法在Java标准库中一定存在，此异常理论上不会发生
            log.error("生成缓存key时发生异常，使用备用方案", e);
            // 备用方案：使用hashCode（不推荐，但作为兜底方案）
            return String.valueOf(keySource.hashCode());
        }
    }

    /**
     * 脱敏处理敏感信息（主机地址）
     * 仅用于日志输出，避免泄露完整的主机地址信息
     *
     * @param hosts 原始主机地址
     * @return 脱敏后的主机地址
     */
    private static String maskSensitiveInfo(String hosts) {
        if (StringUtil.isEmpty(hosts)) {
            return "";
        }

        // 简单脱敏：只显示第一个主机的前几个字符
        String[] hostArray = hosts.split(",");
        if (hostArray.length > 0) {
            String firstHost = hostArray[0].trim();
            if (firstHost.length() > 10) {
                return firstHost.substring(0, 10) + "***";
            }
        }
        return "***";
    }
}
