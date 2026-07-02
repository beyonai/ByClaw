package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Collections;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkProactiveMessageService;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenApiApplicationService;
import com.iwhalecloud.byai.manager.dto.men.NoticeDetail;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class CronService {
  public static final String CRON_CHANGED_EVENT_TYPE = "cron_changed";
  private static final int NOTICE_TITLE_MAX_LENGTH = 200;
  private static final int NOTICE_CONTENT_MAX_LENGTH = 2000;
  private static final short HIGH_PRIORITY = 3;

  private final OpenApiApplicationService openApiApplicationService;

  private final DingtalkProactiveMessageService dingtalkProactiveMessageService;

  public CronService(OpenApiApplicationService openApiApplicationService,
      DingtalkProactiveMessageService dingtalkProactiveMessageService) {
    this.openApiApplicationService = openApiApplicationService;
    this.dingtalkProactiveMessageService = dingtalkProactiveMessageService;
  }

  public boolean isCronChangedEvent(String eventType) {
    return CRON_CHANGED_EVENT_TYPE.equals(eventType);
  }

  public void dispatchCronNotice(JSONObject dataJson) {
    String data = dataJson.getString("data");
    if (StringUtils.isBlank(data)) {
      return;
    }
    JSONObject dataObj = JSONObject.parseObject(data);
    if (dataObj == null) {
      return;
    }
    String action = dataObj.getString("action");
    if ("finished".equals(action)) {
      String title = dataObj.getString("title");
      String content = dataObj.getString("content");
      Long userId = resolveLong(dataObj.get("userId"));
      Long resourceId = resolveLong(dataObj.get("agentId"));
      String userCode = dataObj.getString("userCode");
      if (StringUtils.isAnyBlank(title, content) || userId == null) {
        log.warn("cron notice skipped because required fields are missing, userId={}", userId);
        return;
      }

      NoticeDetail noticeDetail = new NoticeDetail();
      noticeDetail.setTitle(StringUtils.left(title, NOTICE_TITLE_MAX_LENGTH));
      noticeDetail.setContent(StringUtils.left(content, NOTICE_CONTENT_MAX_LENGTH));
      noticeDetail.setSenderId(userId);
      noticeDetail.setSendUserCode(userCode);
      noticeDetail.setTargetId(userId);
      noticeDetail.setTargetUserCode(userCode);
      noticeDetail.setPriority(HIGH_PRIORITY);

      Notices notices = new Notices();
      notices.setNoticeDetails(Collections.singletonList(noticeDetail));
      openApiApplicationService.createNotice(notices);

      if (resourceId != null) {
        try {
          dingtalkProactiveMessageService.sendTextToUser(resourceId, userId, content);
        } catch (Exception e) {
          log.warn("send cron notice to dingtalk failed, resourceId={}, userId={}, content={}",
              resourceId, userId, content, e);
        }
      }
    }
  }

  private Long resolveLong(Object value) {
    if (value instanceof Number) {
      return ((Number) value).longValue();
    }
    if (value instanceof String) {
      String str = StringUtils.trimToNull((String) value);
      if (str == null) {
        return null;
      }
      try {
        return Long.valueOf(str);
      } catch (NumberFormatException e) {
        log.warn("cron notice skipped because value is invalid, value={}", str);
      }
    }
    return null;
  }
}
