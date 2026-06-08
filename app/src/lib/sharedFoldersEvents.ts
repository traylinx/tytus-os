export const SHARED_FOLDERS_CHANGED_EVENT = "tytus:shared-folders-changed";

export const emitSharedFoldersChanged = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHARED_FOLDERS_CHANGED_EVENT));
};

export const onSharedFoldersChanged = (listener: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};

  const handler: EventListener = () => listener();
  window.addEventListener(SHARED_FOLDERS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SHARED_FOLDERS_CHANGED_EVENT, handler);
};
