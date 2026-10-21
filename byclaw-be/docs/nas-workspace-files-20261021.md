# ACS/NAS 文件浏览修复（2026-10-21）

聊天上传、过程文件和本地共享继续使用逻辑用户 bucket 与 /by/.sessions、/by/.shared 路径；不在 ByClaw 引入 NAS 文件系统 ID、配额分配或挂载操作。底层位置由 Platform 的 NAS 空间记录决定。

FileBrowserProviderFactory 在 remote + file/local 模式下统一使用基于 ObjectStorage 的现有通用 provider（历史类名 MinioFileBrowserProvider），不因旧 OPENCLAW 配置或 commercial 品牌切回沙箱文件接口。legacy 和非 file/local 存储保留原选择。业务权限、路径保护与 session/user 隔离不改。

部署时 BE 保持 FILE_STORAGE_TYPE=file、BYCLAW_PLATFORM_EXECUTION_MODE=remote，Platform 设置 PLATFORM_WORKSPACE_STORAGE_TYPE=nas 并加载 NAS 配置。新逻辑在服务重新部署后生效。普通用户验收应覆盖聊天上传→Harness 读取，以及过程文件/本地共享的浏览、上传下载、目录及重命名操作。旧 NFS 历史数据不会因路由切换而自动迁移。

## 验证

- 定向 26 项通过，包括 factory、通用文件 provider、业务权限和 controller。
- reviewer 提出的 remote+OSS 旧选择兼容问题已补回归用例并修复。
- 扩展测试使用 `mvn -B -ntp -f byclaw-be/pom.xml '-Dtest=*,!*Redis*,!*redis*' -DskipITs test`。按用户要求排除 Redis 测试；全量结果及修改前对比见下方记录，不宣称全量通过。

最终扩展回归：5061 项，41 失败、15 错误、18 跳过。修改前 HEAD 的完整独立源码副本复跑同一命令：5056 项，41 失败、15 错误、18 跳过。失败用例集合完全一致，本次新增 5 项 factory 测试全部通过；没有将既有失败当作通过。

失败用例名称（便于后续修复与对照）：

- `com.iwhalecloud.byai.common.i18n.RequestValidationLocalizationTest.augustRequestConstraintsTranslateWhilePreservingFieldNamesAndLimits`
- `com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationServiceTaskQueryTest.rejectsUnknownTaskTypeFilter`
- `com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityCardServiceTest.compile_requiresAtLeastOneEvidence`
- `com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityCardServiceTest.compile_rejectsInvalidModelJson`
- `com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityCardServiceTest.compile_requiresName`
- `com.iwhalecloud.byai.manager.domain.tenant.TenantGroupCoordinationServiceTest.unscopedCandidateAlsoGetsAFileWithNodeMembersExceptItself`
- `com.iwhalecloud.byai.manager.domain.tenant.TenantGroupCoordinationServiceTest.singleMentionClassifiesBeforeApplyingTheTaskContract(long)[1]`
- `com.iwhalecloud.byai.manager.domain.tenant.TenantGroupCoordinationServiceTest.singleMentionClassifiesBeforeApplyingTheTaskContract(long)[2]`
- `com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapperTest.tenantOneIsStillStrict`
- `com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapperTest.filtersBeforePagination`
- `com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapperTest.countDoesNotReadAnyMessageHistory`
- `com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapperTest.literalKeywordAndTotalAgree`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[1]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[2]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[3]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[4]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[5]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String)[6]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.searchKnowledgeMetadata_rejectsMissingResourceIdWithLocalizedMessage`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.searchKnowledgeMetadata_localizesKnowledgeServiceFailure`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[1]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[2]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[3]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[4]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[5]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[6]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.membersCannotRenameOrDeleteOtherUsersItems(ContentOperation)[7]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.metadataCannotChangeCreatorEvenForManagers`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.deleteDataset_rejectsDefaultPersonalDataset`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[1]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[2]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[3]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[4]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[5]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[6]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[7]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[8]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[9]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[10]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation)[11]`
- `com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationServiceTest.missingCreatorDoesNotGrantOrdinaryMemberPermission`
- `com.iwhalecloud.byai.state.domain.chat.service.BackgroundFollowupAdmissionTest.activeCaptainAndUnknownInputStateStillRejectIndependentRequests`
- `com.iwhalecloud.byai.state.domain.groupchat.GroupChatCandidateSessionServiceTest.wrapperRetainsPassiveProvenanceAndOnlyDisplayReferences`
- `com.iwhalecloud.byai.state.domain.groupchat.GroupChatGatewayExecutorTest.attachmentPayloadReceivesPromptWithoutChangingOriginalContent`
- `com.iwhalecloud.byai.state.domain.groupchat.GroupChatGatewayExecutorTest.decoratesOnlyEgressAndRetainsFrozenParentForLaterTurns`
- `com.iwhalecloud.byai.state.domain.groupchat.GroupChatQueuedGatewayTest.eachContinuedTurnUsesItsOwnDispatchAndPublicBoundary`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardCodecTest.reorderedIdsHaveSameHash`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.rejectsUtf8OverflowAndMissingReferences`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.rejectsConflictingReferenceOrigins`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.untypedReferencesReachResolutionWithoutPersistingRawSecrets`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.copiesOrFlattensExistingCard`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.preservesOpaqueReferenceKeysPerItem`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.acceptsHundredItemsAndRejectsExpandedOverflow`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.mapsKnownPassiveLegacyTypes`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.ForwardSnapshotFactoryTest.folderNeverListsChildren`
- `com.iwhalecloud.byai.state.domain.groupchat.forward.GroupChatForwardTargetQueryTest.reusableEligibilityMatchesTheSharedQualificationFixture`
