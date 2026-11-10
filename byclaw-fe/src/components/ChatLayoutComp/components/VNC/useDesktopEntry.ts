import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@umijs/max';
import { useRequest } from 'ahooks';
import useVncOpener from '@/hooks/useVncOpener';
import useAppStore from '@/models/common/useAppStore';
import type { IState as MessageStoreState } from '@/models/useMessageStore';
import { readDesktopLocalHistory } from '@/service/common/desktopLocal';
import { getMessages } from '@/service/message';
import type { IMessage } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import { getDesktopIdentitySnapshot } from '@/utils/auth';
import { getDesktopMessageTargets } from '@/utils/chatVnc';
import { desktopKey, listDesktops, mergeInstanceRefs, resolveDesktop } from '@/utils/desktopInstances';
import { desktopAuthEpoch, registerDesktops, selectDesktop, useDesktopWorkspace } from '@/utils/desktopWorkspace';
import { projectLocalHistoryPage } from '@/utils/localSessionHistory';
import { fetchMessageHandler } from '@/utils/messgae';
import { isSameSessionId, normalizeSessionId, type SessionIdInput } from '@/utils/sessionId';

export type DesktopEntryProps = {
  sessionId?: SessionIdInput;
  latestDigitalEmployeeMessage?: IMessage;
  ownerType?: string;
  messages?: IMessage[];
};

type MessageTargets = ReturnType<typeof getDesktopMessageTargets>;
type DesktopChoices = ReturnType<typeof listDesktops>;

function matchDesktopChoices(choices: DesktopChoices, { refs, legacy }: MessageTargets) {
  if (refs.length) {
    const keys = new Set(refs.map(desktopKey));
    return choices.filter(({ ref }) => keys.has(desktopKey(ref)));
  }
  // Old browser tool messages lack an instance identity. Only use an unambiguous match.
  const vncChoices = legacy ? choices.filter(({ ref }) => ref.instance === 'vnc') : [];
  return vncChoices.length === 1 ? vncChoices : [];
}

export default function useDesktopEntry({
  sessionId,
  latestDigitalEmployeeMessage,
  ownerType = 'session',
  messages,
}: DesktopEntryProps) {
  const id = normalizeSessionId(sessionId);
  const openVnc = useVncOpener(sessionId, ownerType);
  const owner = openVnc.owner || (id ? JSON.stringify([ownerType, id]) : '');
  const preparing = useDesktopWorkspace((state) => state.pendingOwner === owner);
  const entry = useDesktopWorkspace((state) => state.owners[owner]);
  const directory = useAppStore((state) => state.sandboxesInfo);
  const info = useSelector((state: { messageStore?: MessageStoreState }) =>
    ownerType === 'session' && id ? state.messageStore?.sessionListMap?.get(id) : undefined
  );
  const local = useSelector((state: { session?: { sessionList?: ISession[] } }) =>
    Boolean(
      state.session?.sessionList?.some((session) => session.isLocalSession && isSameSessionId(session.sessionId, id))
    )
  );
  const pageSize = info?.pageSize || 0;
  const pageCount = pageSize > 0 ? Math.ceil((info?.total || 0) / pageSize) : 0;
  const lastPage = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 0;
  const [lastLoaded, firstLoaded] = info?.pageRange || [info?.pageNum || 1, info?.pageNum || 1];
  const hasUnloadedPages = Boolean(lastPage && (firstLoaded > 1 || lastLoaded < lastPage));

  const sessionMessages = useMemo(
    () =>
      (messages ?? (latestDigitalEmployeeMessage ? [latestDigitalEmployeeMessage] : [])).filter((message) =>
        isSameSessionId(message.sessionId, id)
      ),
    [id, latestDigitalEmployeeMessage, messages]
  );
  const loaded = useMemo(() => getDesktopMessageTargets(sessionMessages, id), [id, sessionMessages]);
  const scope = id && JSON.stringify([owner, getDesktopIdentitySnapshot()]);
  const directoryKey =
    scope && (loaded.refs.length || loaded.legacy || hasUnloadedPages)
      ? JSON.stringify([scope, loaded.refs, loaded.legacy, hasUnloadedPages])
      : '';
  const { data, error } = useRequest(
    async () => ({ key: directoryKey, rows: await useAppStore.getState().getSandboxesInfoUrl() }),
    { ready: Boolean(directoryKey), refreshDeps: [directoryKey], pollingInterval: 10000, pollingWhenHidden: false }
  );
  const available = useMemo(() => {
    if (!directoryKey || error || data?.key !== directoryKey) return [];
    const rows = (Array.isArray(directory) ? directory : data.rows).filter((row) => row.status === 'RUNNING');
    return listDesktops(rows).filter(
      ({ ref, row }) => row.instanceEndpoints?.[ref.instance]?.trim() && resolveDesktop([row], ref)
    );
  }, [data, directory, directoryKey, error]);

  const loadedChoices = matchDesktopChoices(available, loaded);
  const searchCandidates =
    hasUnloadedPages && available.length && !loadedChoices.length
      ? JSON.stringify(available.map(({ ref }) => desktopKey(ref)).sort())
      : '';
  const searchKey =
    searchCandidates && JSON.stringify([scope, local, pageSize, firstLoaded, lastLoaded, lastPage, searchCandidates]);
  const [history, setHistory] = useState<{ key: string; targets: MessageTargets }>();
  useEffect(() => {
    if (!searchKey) return;
    const request = new AbortController();
    const epoch = desktopAuthEpoch();
    const isCurrent = () => !request.signal.aborted && epoch === desktopAuthEpoch();
    const candidates = new Set<string>(JSON.parse(searchCandidates));
    const loadHistory = async () => {
      let legacy = false;
      let hasExplicitRefs = false;
      // Read only missing pages, and leave the conversation's paged timeline untouched.
      for (let pageNum = 1; pageNum <= lastPage && isCurrent(); pageNum += 1) {
        if (pageNum >= firstLoaded && pageNum <= lastLoaded) continue;
        const params = { sessionId: id, pageNum, pageSize };
        let page: IMessage[];
        if (local) {
          page = projectLocalHistoryPage(await readDesktopLocalHistory(params), id);
        } else {
          const { list } = await getMessages(params, { cancelToken: request, responseCfg: { hideErrorTips: true } });
          page = (Array.isArray(list) ? list : [])
            .filter(
              (message: { usage?: string | number }) => message.usage === undefined || String(message.usage) === '2'
            )
            .map(fetchMessageHandler);
        }
        if (!isCurrent()) return;
        const found = getDesktopMessageTargets(page, id);
        const matches = found.refs.filter((ref) => candidates.has(desktopKey(ref)));
        if (matches.length) {
          setHistory({ key: searchKey, targets: { refs: matches, legacy: false } });
          return;
        }
        legacy ||= found.legacy;
        hasExplicitRefs ||= found.refs.length > 0;
      }
      if (isCurrent()) setHistory({ key: searchKey, targets: { refs: [], legacy: legacy && !hasExplicitRefs } });
    };
    void loadHistory().catch(() => undefined);
    return () => request.abort();
  }, [searchKey, searchCandidates, id, local, firstLoaded, lastLoaded, lastPage, pageSize]);

  const historyTargets = searchKey && history?.key === searchKey ? history.targets : undefined;
  useEffect(() => {
    if (!owner) return;
    const refs = sessionMessages.flatMap((message) =>
      [...(message.thinkList || []), ...(message.messageList || [])].flatMap((item) => item.content?.instanceRefs || [])
    );
    registerDesktops(owner, [...refs, ...(historyTargets?.refs || [])]);
  }, [owner, sessionMessages, historyTargets]);

  let choices = loadedChoices;
  if (historyTargets) {
    choices = matchDesktopChoices(available, {
      refs: mergeInstanceRefs(loaded.refs, historyTargets.refs),
      legacy: loaded.legacy || historyTargets.legacy,
    });
  }
  const target = choices.find(({ ref }) => desktopKey(ref) === entry?.selected) || choices[0];
  const openDesktop =
    target &&
    (() => {
      selectDesktop(owner, target.ref);
      openVnc();
    });
  const count = entry?.refs.filter((ref) => !entry.hidden.includes(desktopKey(ref))).length || 0;
  return { openDesktop, count, preparing };
}
