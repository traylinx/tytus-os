import type { FC } from 'react';
import AppPlaceholder from './AppPlaceholder';

interface AppRouterProps {
  appId: string;
  windowId: string;
}

const AppRouter: FC<AppRouterProps> = ({ appId }) => {
  // All 8 v1 apps render placeholders until their phase wires up the daemon.
  // Replace cases here as each Phase ships.
  return <AppPlaceholder appId={appId} />;
};

export default AppRouter;
