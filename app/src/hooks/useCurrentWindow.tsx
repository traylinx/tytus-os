// Provides the currently-rendering window's record (id, args, etc.) to
// any descendant. Set by WindowFrame when it renders an app body.
//
// Apps that want to react to OPEN_WINDOW args (Phase 7 cont — open-with
// hooks routes a file name through here) should call
// `useCurrentWindowArgs()`. Apps not rendered inside a WindowFrame get
// `undefined` and behave as standalone surfaces.

import { createContext, useContext, type ReactNode, type FC } from 'react';
import type { Window, WindowArgs } from '@/types';

const WindowContext = createContext<Window | null>(null);

export const WindowContextProvider: FC<{
  window: Window;
  children: ReactNode;
}> = ({ window, children }) => (
  <WindowContext.Provider value={window}>{children}</WindowContext.Provider>
);

export const useCurrentWindow = (): Window | null => useContext(WindowContext);

export const useCurrentWindowArgs = (): WindowArgs | undefined => {
  const win = useContext(WindowContext);
  return win?.args;
};
