package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * QA Markdown 文件入站、出站引用关系。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KnowledgeItemReferencesResult {

    private List<Item> inbound = new ArrayList<>();

    private List<Item> outbound = new ArrayList<>();

    @Getter
    @Setter
    public static class Item {

        private String sourcePath;

        private String originalTarget;

        private String targetSuffix;

        private String targetPath;

        private String status;
    }
}
