package com.iwhalecloud.byai.manager.domain.conversation.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.conversation.FeedbackMsgInfo;
import com.iwhalecloud.byai.manager.mapper.conversation.FeedbackMsgInfoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.List;

/**
 * 反馈消息service
 */
@Service
public class FeedbackMsgInfoService {

    @Autowired
    private FeedbackMsgInfoMapper feedbackMsgInfoMapper;

    /**
     * 根据feedbackMsgId查询反馈消息信息列表
     *
     * @param feedbackMsgId 反馈消息ID
     * @return 反馈消息信息列表
     */
    public List<FeedbackMsgInfo> selectByFeedbackMsgId(Long feedbackMsgId) {
        LambdaQueryWrapper<FeedbackMsgInfo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(FeedbackMsgInfo::getFeedbackMsgId, feedbackMsgId);
        return feedbackMsgInfoMapper.selectList(wrapper);
    }

    /**
     * 批量保存反馈消息信息
     *
     * @param feedbackMsgInfoList 反馈消息信息列表
     * @return 保存是否成功
     */
    public boolean saveBatch(List<FeedbackMsgInfo> feedbackMsgInfoList) {
        if (CollectionUtils.isEmpty(feedbackMsgInfoList)) {
            return true;
        }
        int rows = feedbackMsgInfoMapper.saveBatch(feedbackMsgInfoList);
        return rows > 0;
    }

    /**
     * 保存单个反馈消息信息
     *
     * @param feedbackMsgInfo 反馈消息信息
     * @return 保存是否成功
     */
    public boolean save(FeedbackMsgInfo feedbackMsgInfo) {
        return feedbackMsgInfoMapper.insert(feedbackMsgInfo) > 0;
    }

    /**
     * 根据ID更新反馈消息信息
     *
     * @param feedbackMsgInfo 反馈消息信息
     * @return 更新是否成功
     */
    public boolean updateById(FeedbackMsgInfo feedbackMsgInfo) {
        return feedbackMsgInfoMapper.updateById(feedbackMsgInfo) > 0;
    }

}
