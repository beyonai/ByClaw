package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * QA 知识库文件导入批量结果。单文件上传同样返回单元素列表。
 */
@Getter
@Setter
public class KbImportResult {

    private List<Item> data = new ArrayList<>();

    private Summary summary = new Summary();

    private List<String> postProcessErrors = new ArrayList<>();

    @Getter
    @Setter
    public static class Item {

        private String filePath;

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
