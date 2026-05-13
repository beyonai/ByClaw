package com.iwhalecloud.byai.common.feign.request.manager;

import lombok.Data;
import java.util.List;

@Data
public class FindQo {

    private Integer pageSize = 10;

    private Integer pageIndex = 1;

    private String type;

    private String keyword;

    /**
     * 会话类型 h_as：人与超级助手/数字员工单聊 hs_as：群聊 h_h：人与人单聊
     */
    private String sessionType;

    /**
     * 搜索类型数组，为空时执行所有类型的搜索 支持的类型： - message：消息内容搜索 - participant：查询参与人 - title：查询会话标题
     */
    private List<String> searchType;
}
