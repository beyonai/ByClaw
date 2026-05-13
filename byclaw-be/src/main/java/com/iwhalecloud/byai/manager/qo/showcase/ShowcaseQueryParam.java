package com.iwhalecloud.byai.manager.qo.showcase;

import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

/**
 * 成果空间查询参数
 *
 * <p>负责承载查询条件，并提供标准化方法，确保分页参数合法、字符串过滤条件去除空值。</p>
 */

@Setter
@Getter
public class ShowcaseQueryParam {

    private static final int DEFAULT_PAGE_NUM = 1;

    private static final int DEFAULT_PAGE_SIZE = 20;

    private static final int MAX_PAGE_SIZE = 100;

    private Long sessionId;

    private String type;

    private Long agentId;

    private Long taskId;

    private String keyword;

    private Boolean queryAll = false;

    private String sessionMode;

    private Integer status;

    private Integer pageNum;

    private Integer pageSize;

    private List<Long> messageIds;

    private Long createBy;


    /**
     * 生成标准化后的查询参数，处理分页默认值与空白过滤条件
     *
     * @return 归一化后的查询参数
     */
    public ShowcaseQueryParam normalize() {
        ShowcaseQueryParam normalized = new ShowcaseQueryParam();
        normalized.setSessionId(this.sessionId);
        normalized.setAgentId(this.agentId);
        normalized.setTaskId(this.taskId);
        normalized.setType(convertToFilterValue(this.type));
        normalized.setKeyword(convertToFilterValue(this.keyword));
        normalized.setSessionMode(convertToFilterValue(this.sessionMode));
        Integer currentStatus = this.status;
        normalized.setStatus(currentStatus != null ? currentStatus : Integer.valueOf(1));
        normalized.setMessageIds(this.messageIds);

        int safePageNum = this.pageNum == null || this.pageNum <= 0 ? DEFAULT_PAGE_NUM : this.pageNum;
        int safePageSize = this.pageSize == null || this.pageSize <= 0 ? DEFAULT_PAGE_SIZE : this.pageSize;
        safePageSize = Math.min(safePageSize, MAX_PAGE_SIZE);

        normalized.setPageNum(safePageNum);
        normalized.setPageSize(safePageSize);
        return normalized;
    }

    private String convertToFilterValue(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        String trimmed = value.trim();
        return "all".equalsIgnoreCase(trimmed) ? null : trimmed;
    }
}




