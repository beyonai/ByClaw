package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * QA 知识库文件或目录批量移动结果。
 */
@Getter
@Setter
public class KnowledgeItemsMoveResult {

    private List<Item> data = new ArrayList<>();

    private Summary summary = new Summary();

    @Getter
    @Setter
    public static class Item {

        private String sourcePath;

        private String targetPath;

        private Boolean success;

        private String error;
    }

    @Getter
    @Setter
    public static class Summary {

        private Integer total;

        private Integer succeeded;

        private Integer failed;
    }
}
