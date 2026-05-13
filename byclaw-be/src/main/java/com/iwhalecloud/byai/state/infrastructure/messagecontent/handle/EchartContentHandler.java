package com.iwhalecloud.byai.state.infrastructure.messagecontent.handle;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.common.enums.ChatBiAnswerTypeEnum;
import lombok.extern.slf4j.Slf4j;

import java.util.Optional;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/10
 */
@Slf4j
public final class EchartContentHandler implements MessageContentHandler {
    @Override
    public String handle(String content) {
        JSONObject jsonObject = JSONObject.parseObject(content);
        Integer answerType = jsonObject.getInteger("answerType");
        String answer = jsonObject.getString("answer");
        if (ChatBiAnswerTypeEnum.TEXT.getCode().equals(answerType)) {
            return answer;
        } else if (ChatBiAnswerTypeEnum.QUERY_DATA_RESULT.getCode().equals(answerType)
                || ChatBiAnswerTypeEnum.KNOWLEDGE_ROUTER.getCode().equals(answerType)) {
            JSONObject answerJson = JSON.parseObject(answer);
            JSONArray jsonArray = answerJson.getJSONArray("queryDataResultList");
            if (jsonArray == null || jsonArray.isEmpty()) {
                log.warn("chatBi sse response is not valid: queryDataResultList is empty");
                return content;
            }
            JSONObject resultObject = jsonArray.getJSONObject(0);
            String desc = Optional.ofNullable(resultObject.getString("desc")).orElse("");
            JSONObject queryResult = resultObject.getJSONObject("queryResult");
            if (queryResult == null) {
                log.warn("chatBi sse response is not valid: queryResult is null");
                return content;
            }
            answer = Optional.ofNullable(queryResult.getString("resultData")).orElse(content);
            return desc + "\n" + answer;
        }
        return content;
    }
}

