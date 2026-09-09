package com.iwhalecloud.byai.manager.vo.digitemploy;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 批量安装资源结果。
 *
 * @author qin.guoquan
 * @date 202-09-03 20:38:38
 */
@Getter
@Setter
public class DigitalEmployeeBatchInstallResultVo {

    private int totalCount;

    private int successCount;

    private int failureCount;

    private List<Item> results = new ArrayList<>();

    @Getter
    @Setter
    public static class Item {

        @JsonSerialize(using = ToStringSerializer.class)
        private Long digitalEmployeeId;

        private boolean success;

        private String message;
    }
}
