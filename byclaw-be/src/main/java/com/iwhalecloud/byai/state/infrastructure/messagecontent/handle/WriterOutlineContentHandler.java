package com.iwhalecloud.byai.state.infrastructure.messagecontent.handle;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/10
 */
public final class WriterOutlineContentHandler implements MessageContentHandler {
    @Override
    public String handle(String content) {
        JSONObject writer = JSON.parseObject(content);
        String title = writer.getString("title");
        JSONArray outlines = writer.getJSONArray("outlines");

        StringBuilder formattedOutline = new StringBuilder();
        formattedOutline.append("# ").append(title).append("\n");

        processOutlineItems(outlines, formattedOutline, 2);

        return formattedOutline.toString();
    }

    /**
     * 递归处理大纲项及其子项
     * @param items 大纲项数组
     * @param builder 字符串构建器
     * @param level 当前层级
     */
    private static void processOutlineItems(JSONArray items, StringBuilder builder, int level) {
        if (items == null || items.isEmpty()) {
            return;
        }

        for (int i = 0; i < items.size(); i++) {
            JSONObject item = items.getJSONObject(i);
            String outlineName = item.getString("outlineName");

            // 添加当前层级标题
            for (int j = 0; j < level; j++) {
                builder.append('#');
            }
            builder.append(' ').append(outlineName).append('\n');

            // 递归处理子项
            JSONArray children = item.getJSONArray("children");
            if (children != null && !children.isEmpty()) {
                processOutlineItems(children, builder, level + 1);
            }
        }
    }

}

