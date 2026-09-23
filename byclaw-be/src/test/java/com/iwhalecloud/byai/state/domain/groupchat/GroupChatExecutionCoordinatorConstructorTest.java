package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Constructor;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;

class GroupChatExecutionCoordinatorConstructorTest {
    @Test
    void exposesSingleConstructorForSpringDependencyInjection() {
        Constructor<?>[] constructors = GroupChatExecutionCoordinator.class.getConstructors();

        assertEquals(1, constructors.length);
        assertEquals(4, constructors[0].getParameterCount());
        assertTrue(constructors[0].getParameterTypes()[2].getName().endsWith("GroupChatGatewayExecutor"));
    }
}
