package com.iwhalecloud.byai.manager.domain.event.devloop;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * Published after a user's GitHub token configuration is persisted.
 */
@Getter
public class GitHubTokenConfiguredEvent extends ApplicationEvent {

    private final Long userId;

    public GitHubTokenConfiguredEvent(Object source, Long userId) {
        super(source);
        this.userId = userId;
    }
}
