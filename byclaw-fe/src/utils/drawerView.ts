/** Atomic drawer requests isolate late external business updates from newer views. */
export type DrawerViewHandle = { owner: string; generation: number };
let generation = 0;
export function openDrawerView(
  emitter: any,
  owner: string,
  config: Record<string, unknown>,
  content: Record<string, unknown>
) {
  const handle = { owner, generation: ++generation };
  emitter.emit('beyond-drawer-view', { action: 'open', handle, config, content });
  return handle;
}
export function updateDrawerView(emitter: any, handle: DrawerViewHandle | undefined, content: Record<string, unknown>) {
  if (handle) emitter.emit('beyond-drawer-view', { action: 'update', handle, content });
}
export function closeDrawerView(emitter: any, handle: DrawerViewHandle | undefined) {
  if (handle) emitter.emit('beyond-drawer-view', { action: 'close', handle });
}
