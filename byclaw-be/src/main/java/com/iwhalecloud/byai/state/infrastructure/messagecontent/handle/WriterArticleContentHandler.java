package com.iwhalecloud.byai.state.infrastructure.messagecontent.handle;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

import java.util.Optional;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/10
 */
public final  class WriterArticleContentHandler implements MessageContentHandler {
    @Override
    public String handle(String content) {
        JSONObject writer = JSON.parseObject(content);
        String writerContent = writer.getString("content");
        JSONObject contentJson = JSON.parseObject(writerContent);
        JSONArray mainContent = contentJson.getJSONArray("main");
        StringBuilder articleContent = new StringBuilder();
        for (int i = 0; i < mainContent.size(); i++) {
            JSONObject item = mainContent.getJSONObject(i);
            JSONArray titleValueList = item.getJSONArray("valueList");
            String value = Optional.ofNullable(item.getString("value")).orElse("");
            if (titleValueList != null) {
                for (int j = 0; j < titleValueList.size(); j++) {
                    JSONObject titleValue = titleValueList.getJSONObject(j);
                    String title = Optional.ofNullable(titleValue.getString("value")).orElse("");
                    articleContent.append(title).append("\n");
                }
            } else {
                articleContent.append(value).append("\n");
            }
        }
        return articleContent.toString();
    }
}
