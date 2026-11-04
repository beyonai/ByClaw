package com.iwhalecloud.byai.manager.mapper.auth;

import com.iwhalecloud.byai.manager.dto.auth.AuthorizationSubject;
import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface AuthorizationSubjectMapper {
    List<AuthorizationSubject> memberships(@Param("userIds") List<Long> userIds);
}
