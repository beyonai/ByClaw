package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * QA 更新知识库单文件的结果。
 */
@Getter
@Setter
public class KbFileUpdateResult {

    private List<Item> data = new ArrayList<>();

    @Getter
    @Setter
    public static class Item {

        private String knCode;

        private String filePath;

        private Boolean success;

        private String error;
    }
}
