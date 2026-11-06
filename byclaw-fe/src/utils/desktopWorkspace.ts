import { create } from 'zustand';
import { desktopKey, mergeInstanceRefs, type SandboxInstanceRef } from './desktopInstances';
import { getAuthSnapshot, getDesktopIdentitySnapshot } from './auth';

type OwnerState = {
  refs: SandboxInstanceRef[];
  hidden: string[];
  selected?: string;
  handled?: boolean;
  unseen?: string[];
};
const empty = (): OwnerState => ({ refs: [], hidden: [] });
const mountedOwners = new Map<string, Set<symbol>>();
let auth = '';
let epoch = 0;
export function desktopAuthEpoch() {
  const next = JSON.stringify([getAuthSnapshot(), getDesktopIdentitySnapshot()]);
  if (auth !== next) {
    if (auth) {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith('desktop-workspace:')) sessionStorage.removeItem(key);
      }
    }
    auth = next;
    epoch += 1;
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    useDesktopWorkspace.setState((state) => ({
      owners: {},
      activeOwner: mountedOwners.has(state.activeOwner) ? state.activeOwner : '',
      visible: false,
      pendingOwner: '',
    }));
  }
  return epoch;
}
const storageKey = (owner: string) => {
  const identity = getDesktopIdentitySnapshot();
  return `desktop-workspace:${JSON.stringify([identity.account, identity.enterpriseId, owner])}`;
};
const restore = (owner: string): OwnerState => {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey(owner)) || 'null');
    if (!data) return empty();
    return {
      refs: mergeInstanceRefs([], data.refs),
      hidden: Array.isArray(data.hidden) ? data.hidden.filter((key: unknown) => typeof key === 'string') : [],
      selected: typeof data.selected === 'string' ? data.selected : undefined,
      handled: data.handled === true,
      unseen: Array.isArray(data.unseen) ? data.unseen.filter((key: unknown) => typeof key === 'string') : [],
    };
  } catch {
    return empty();
  }
};
export const useDesktopWorkspace = create<{
  owners: Record<string, OwnerState>;
  activeOwner: string;
  visible: boolean;
  revision: number;
  panel: string;
  pendingOwner?: string;
}>()(() => ({ owners: {}, activeOwner: '', visible: false, revision: 0, panel: '' }));

/** The title and stream handler share one chat; only its last subscriber releases the viewer. */
export function mountDesktopOwner(owner: string) {
  const subscriber = Symbol(owner);
  const subscribers = mountedOwners.get(owner) || new Set<symbol>();
  subscribers.add(subscriber);
  mountedOwners.set(owner, subscribers);
  if (useDesktopWorkspace.getState().activeOwner !== owner)
    useDesktopWorkspace.setState((state) => ({
      activeOwner: owner,
      visible: false,
      pendingOwner: '',
      revision: state.revision + 1,
    }));
  return () => {
    if (!subscribers.delete(subscriber) || subscribers.size) return;
    mountedOwners.delete(owner);
    if (useDesktopWorkspace.getState().activeOwner !== owner) return;
    useDesktopWorkspace.setState((state) => ({
      activeOwner: Array.from(mountedOwners.keys()).pop() || '',
      visible: false,
      pendingOwner: '',
      revision: state.revision + 1,
    }));
  };
}
export function getDesktopOwner(owner: string) {
  desktopAuthEpoch();
  return useDesktopWorkspace.getState().owners[owner] || restore(owner);
}
export function updateDesktopOwner(owner: string, update: Partial<OwnerState>) {
  if (!owner) return;
  const value = { ...getDesktopOwner(owner), ...update };
  useDesktopWorkspace.setState((state) => ({ owners: { ...state.owners, [owner]: value } }));
  try {
    sessionStorage.setItem(storageKey(owner), JSON.stringify(value));
  } catch {
    return;
  }
}
export function registerDesktops(owner: string, refs: unknown, live = false) {
  const current = getDesktopOwner(owner);
  const merged = mergeInstanceRefs(current.refs, refs);
  const unseen = [
    ...(current.unseen || []),
    ...(live && current.refs.length
      ? merged.filter((ref) => !current.refs.some((known) => desktopKey(known) === desktopKey(ref))).map(desktopKey)
      : []),
  ];
  updateDesktopOwner(owner, {
    unseen,
    refs: merged,
    selected: current.selected || (merged[0] && desktopKey(merged[0])),
  });
}
export function selectDesktop(owner: string, ref: SandboxInstanceRef) {
  useDesktopWorkspace.setState((state) => ({ revision: state.revision + 1, pendingOwner: '' }));
  registerDesktops(owner, [ref]);
  updateDesktopOwner(owner, {
    selected: desktopKey(ref),
    hidden: getDesktopOwner(owner).hidden.filter((key) => key !== desktopKey(ref)),
    handled: true,
    unseen: getDesktopOwner(owner).unseen?.filter((key) => key !== desktopKey(ref)),
  });
}
export function migrateDesktopOwner(previous: string, next: string) {
  if (!previous || !next || previous === next) return;
  const source = getDesktopOwner(previous);
  const target = getDesktopOwner(next);
  updateDesktopOwner(next, {
    ...source,
    refs: mergeInstanceRefs(target.refs, source.refs),
    hidden: Array.from(new Set([...target.hidden, ...source.hidden])),
    selected: source.selected || target.selected,
    handled: source.handled || target.handled,
  });
  const owners = { ...useDesktopWorkspace.getState().owners };
  delete owners[previous];
  useDesktopWorkspace.setState({ owners });
  try {
    sessionStorage.removeItem(storageKey(previous));
  } catch {
    return;
  }
}
