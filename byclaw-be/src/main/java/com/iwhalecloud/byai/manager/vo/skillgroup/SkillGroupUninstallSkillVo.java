package com.iwhalecloud.byai.manager.vo.skillgroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupUninstallSkillVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceName;

    private Boolean manualSource;

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> otherGroupIds = new ArrayList<>();

    private List<String> otherGroupNames = new ArrayList<>();
}
