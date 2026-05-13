package com.iwhalecloud.byai.state.infrastructure.utils;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import com.alibaba.fastjson.JSONArray;
import org.apache.commons.lang3.StringUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.MessageContentHandlerFactory;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.MessageContentHandler;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public final class CompletionsUtils {

    private static final Logger logger = LoggerFactory.getLogger(CompletionsUtils.class);


    private CompletionsUtils() {

    }

    public static void setResHeader(HttpServletResponse res, Boolean stream) {
        if (null == stream) {
            log.warn("stream = null，dont't set any res header。");
            return;
        }
        if (stream) {
            res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setCharacterEncoding("UTF-8");
        } else {
            res.setContentType("application/json");
            res.setCharacterEncoding("UTF-8");
        }
    }


    /**
     * 写出流式响应数据，有event、data字段的。
     *
     * @param res       输出流
     * @param event     事件类型
     * @param data      数据内容
     */
    public static void responseWrite(OutputStream res, String event, String data) {
        if (res == null) {
            return;
        }
        if (res instanceof ServletOutputStream) {
            if (StringUtils.isNotEmpty(event)) {
                String str = "event: " + event + "\n";
                logger.info("write data to web: {}", str);
                responseWrite(res, str);
            }

            String str = "data: " + data + "\n\n";
            logger.info("write data to web: {}", str);
            responseWrite(res, str);
        } else if (res instanceof ByteArrayOutputStream) {
            try {
                JSONObject jsonObject = JSONObject.parseObject(data);
                jsonObject.put("event", event);
                responseWrite(res, jsonObject.toJSONString());
            } catch (Exception e) {
                try {
                    JSONArray jsonArray = JSONArray.parseArray(data);
                    for (int i = 0; i < jsonArray.size(); i++) {
                        JSONObject jsonObject = jsonArray.getJSONObject(i);
                        jsonObject.put("event", event);
                        responseWrite(res, jsonObject.toJSONString());
                    }
                } catch (Exception e2) {
                    responseWrite(res, data);
                }
            }

        } else {
            throw new RuntimeException(I18nUtil.get("completions.utils.no.support"));
        }

    }

    /**
     * WebSocket场景写出流式响应数据，自动将sessionId注入到data JSON中。
     * 仅在 ByteArrayOutputStream 时注入，ServletOutputStream（SSE）保持原有逻辑不变。
     *
     * @param res       输出流
     * @param event     事件类型
     * @param data      数据内容（JSON字符串）
     * @param sessionId 会话ID，将自动注入到 data JSON 的 sessionId 字段
     */
    public static void responseWrite(OutputStream res, String event, String data, Long sessionId) {
        if (res == null) {
            return;
        }
        if (res instanceof ByteArrayOutputStream) {
            try {
                JSONObject jsonObject = JSONObject.parseObject(data);
                jsonObject.put("sessionId", sessionId);
                jsonObject.put("event", event);
                responseWrite(res, jsonObject.toJSONString());
            } catch (Exception e) {
                try {
                    JSONArray jsonArray = JSONArray.parseArray(data);
                    for (int i = 0; i < jsonArray.size(); i++) {
                        JSONObject jsonObject = jsonArray.getJSONObject(i);
                        jsonObject.put("sessionId", sessionId);
                        jsonObject.put("event", event);
                        responseWrite(res, jsonObject.toJSONString());
                    }
                } catch (Exception e2) {
                    // data 为非 JSON 纯文本或 null，直接包装为 JSON 结构写出
                    JSONObject wrapper = new JSONObject();
                    wrapper.put("event", event);
                    wrapper.put("sessionId", sessionId);
                    if (data != null) {
                        wrapper.put("data", data);
                    }
                    responseWrite(res, wrapper.toJSONString());
                }
            }
        } else {
            // ServletOutputStream（SSE）无需注入 sessionId
            responseWrite(res, event, data);
        }
    }

    /**
     * 写出响应数据
     *
     * @param res
     * @param data
     */
    public static void responseWrite(OutputStream res, String data) {
        try {
            res.write(data.getBytes(StandardCharsets.UTF_8));
            res.flush();
        } catch (IOException e) {
            throw new BdpRuntimeException(e.getMessage(), e);
        }
    }

    /**
     * 关闭res
     *
     * @param res
     */
    public static void closeResponseWriter(HttpServletResponse res) {
        Writer writer;
        try {
            writer = res.getWriter();
            writer.close();
        } catch (IOException e) {
            throw new BdpRuntimeException(e.getMessage(), e);
        }

    }

    public static String getSseContext(AnswerDelta textObject) {
        try {
            List<ChoiceDto> choices = textObject.getChoices();
            // 数字员工卡片内容不需要写到内容中
            if (MessageContentTypeEnum.DIGIT.getCode().equals(textObject.getContentType())) {
                return null;
            }
            //if (MessageContentTypeEnum.ECHART.getCode().equals(textObject.getString("contentType"))) {
            //    return choices.get(0).toString();
            //}
            for (ChoiceDto choice : choices) {
                DeltaDto delta = choice.getDelta();
                return handleContent(delta.getContent(), textObject.getContentType());
            }

            return null;
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            return null;
        }
    }

    public static String getSseContext(String text) {
        try {
            AnswerDelta textObject = JSONObject.parseObject(text, AnswerDelta.class);
            return getSseContext(textObject);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            return null;
        }
    }

    private static String handleContent(String content, String contentType) {
        if (StringUtils.isEmpty(content)) {
            return content;
        }
        MessageContentHandler handler = MessageContentHandlerFactory.getHandler(contentType);
        return handler.handle(content);
    }


    /**
     * 整合消息内容和消息框架（因为是增量处理，在第一次拿到增量信息的时候缓存框架，在最终保存之前，需要把框架中的消息更新为完整的消息
     * ，这样将来在查询历史消息的时候，才能查询到完整的消息）
     *
     * @param messageStruct 消息骨架
     * @param context       具体需要设置的content内容
     * @return
     */
    public static AnswerDelta parseMessageStruct(String messageStruct, String context) {
        try {
            // 消息框框架转为为对象
            AnswerDelta answerDelta = JSONObject.parseObject(messageStruct, AnswerDelta.class);
            List<ChoiceDto> choices = new ArrayList<>();
            ChoiceDto choiceDto = new ChoiceDto();
            // 消息内容体会为完整的消息内容
            choiceDto.setDelta(new DeltaDto(context));
            choices.add(choiceDto);
            answerDelta.setChoices(choices);
            // 返回整合后的消息框架
            return answerDelta;

        } catch (Exception e) {
            log.error(e.getMessage(), e);
            return null;
        }
    }

}
