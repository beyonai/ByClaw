package com.iwhalecloud.byai.state.application.service.callback;

import java.util.HashMap;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.state.domain.callback.dto.CallbackRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import lombok.extern.slf4j.Slf4j;

/**
 * 回调应用服务
 *
 * @author system
 * @date 2025-01-27
 */
@Service
@Slf4j
public class CallbackApplicationService {

    private static final String CALLBACK_RECORD_PREFIX = "callback:record:";

    /**
     * 构建回调记录Key
     */
    private String buildCallbackRecordKey(String sessionId, String messageId, Long timestamp) {
        return CALLBACK_RECORD_PREFIX + sessionId + ":" + messageId + ":" + timestamp;
    }

    /**
     * 根据会话ID和消息ID查询回调记录
     *
     * @param sessionId 会话ID
     * @param messageId 消息ID
     * @return 回调记录JSON字符串
     */
    private String getCallbackRecord(String sessionId, String messageId, Long timestamp) {
        try {
            String recordKey = buildCallbackRecordKey(sessionId, messageId, timestamp);
            return RedisUtil.getString(recordKey);
        }
        catch (Exception e) {
            log.error("查询回调记录失败，sessionId: {}, messageId: {}", sessionId, messageId, e);
            return null;
        }
    }

    /**
     * 查询回调结果
     *
     * @param request 回调请求参数
     * @return 回调查询结果
     */
    public ResponseUtil callBackSearch(CallbackRequest request) {
        try {
            // 1. 验证必要参数
            if (StringUtils.isBlank(request.getChatId()) || StringUtils.isBlank(request.getMessageId())) {
                return ResponseUtil.fail("缺少必要参数：sessionId和messageId不能为空");
            }

            // 2. 查询回调记录
            String recordJson = getCallbackRecord(request.getChatId(), request.getMessageId(), request.getTimestamp());

            if (recordJson == null) {
                // 没有找到回调记录，返回处理中状态
                Map<String, Object> result = new HashMap<>();
                result.put("sessionId", request.getChatId());
                result.put("messageId", request.getMessageId());
                result.put("timestamp", request.getTimestamp());
                result.put("status", "PROCESSING");
                result.put("message", "回调处理中，请稍后查询");

                log.info("查询回调结果 - 未找到记录，返回处理中状态，sessionId: {}, messageId: {}", request.getChatId(),
                    request.getMessageId());
                return ResponseUtil.successResponse(result);
            }

            // 3. 解析回调记录
            JSONObject recordData = JSON.parseObject(recordJson);
            String status = recordData.getString("status");

            // 4. 构建返回结果
            Map<String, Object> result = new HashMap<>();
            result.put("sessionId", recordData.get("sessionId"));
            result.put("messageId", recordData.get("messageId"));
            result.put("timestamp", recordData.get("timestamp"));
            result.put("status", status);
            Object message = recordData.get("message");
            // 5. 根据状态设置相应的消息
            switch (status) {
                case "PROCESSING":
                    result.put("message", "回调处理中，请稍后查询");
                    break;
                case "SUCCESS", "FAILED":
                    result.put("message", message);
                    break;
                default:
                    result.put("message", "未知状态：" + status);
                    break;
            }

            log.info("查询回调结果成功，sessionId: {}, messageId: {}, status: {}", request.getChatId(), request.getMessageId(),
                status);
            return ResponseUtil.successResponse(result);

        }
        catch (Exception e) {
            log.error("查询回调结果异常，sessionId: {}, messageId: {}", request.getChatId(), request.getMessageId(), e);
            return ResponseUtil.fail("查询回调结果异常: " + e.getMessage());
        }
    }
}
