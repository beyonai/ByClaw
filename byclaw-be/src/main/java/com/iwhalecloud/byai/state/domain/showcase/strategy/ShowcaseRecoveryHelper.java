package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.manager.mapper.showcase.ByaiShowcaseMapper;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class ShowcaseRecoveryHelper {

    // 0 表示无效状态
    private static final Integer STATUS_DELETED = 0;

    //1 表示正常状态
    private static final Integer STATUS_NORMAL = 1;


    private final ByaiShowcaseMapper byaiShowcaseMapper;

    public ShowcaseRecoveryHelper(ByaiShowcaseMapper byaiShowcaseMapper) {
        this.byaiShowcaseMapper = byaiShowcaseMapper;
    }

    public boolean recoverIfNecessary(ByaiShowcase showcase) {
        if (showcase == null) {
            return false;
        }
        if (StringUtils.equalsIgnoreCase("chat", showcase.getType())) {
            return false;
        }
        if (showcase.getSessionId() == null) {
            return false;
        }
        if (StringUtils.isBlank(showcase.getFileCode())) {
            return false;
        }
        ByaiShowcase deleted = byaiShowcaseMapper.selectDeletedRecord(showcase.getSessionId(), showcase.getType(),
            showcase.getMessageId(), showcase.getFileCode());
        if (deleted == null) {
            return false;
        }

        if (!STATUS_DELETED.equals(deleted.getStatus())) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.content.already.collected"));
        }
        Date now = new Date();
        deleted.setStatus(STATUS_NORMAL);
        deleted.setUpdateTime(now);
        deleted.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        byaiShowcaseMapper.updateById(deleted);

        showcase.setId(deleted.getId());
        showcase.setUrl(deleted.getUrl());
        showcase.setFileId(deleted.getFileId());
        showcase.setName(deleted.getName());
        showcase.setContent(deleted.getContent());
        showcase.setFileCode(deleted.getFileCode());
        showcase.setUpdateTime(now);
        showcase.setUpdateBy(deleted.getUpdateBy());
        showcase.setRecovered(true);
        log.info("发现已删除成果记录，直接恢复 id={} sessionId={} type={} fileCode={}", deleted.getId(),
            deleted.getSessionId(), deleted.getType(), deleted.getFileCode());
        return true;
    }
}
