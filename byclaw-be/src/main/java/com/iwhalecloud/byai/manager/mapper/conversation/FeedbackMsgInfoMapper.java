package com.iwhalecloud.byai.manager.mapper.conversation;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.conversation.FeedbackMsgInfo;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * @author cxf
 * @description: 反馈消息Mapper
 * @date 2025/9/9 09:35
 */
public interface FeedbackMsgInfoMapper extends BaseMapper<FeedbackMsgInfo> {

    /**
     * 批量保存反馈消息信息
     *
     * @param feedbackMsgInfoList 反馈消息信息列表
     * @return 影响行数
     */
    int saveBatch(@Param("feedbackMsgInfoList") List<FeedbackMsgInfo> feedbackMsgInfoList);
}
