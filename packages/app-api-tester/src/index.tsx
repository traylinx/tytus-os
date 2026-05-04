/**
 * @tytus/app-api-tester — API Tester workspace package entry.
 *
 * Skeleton phase: placeholder. Phase 5 lifts the legacy
 * `app/src/apps/ApiTester.tsx` source into this package, then carves
 * to its own git repo (`tytus-app-api-tester`).
 */

import type { AppBootEnv } from '@tytus/host-api';
import { ApiTesterPlaceholder } from './ApiTesterPlaceholder';

export default function bootApiTester(env: AppBootEnv) {
  // eslint-disable-next-line react-refresh/only-export-components
  return function ApiTesterApp() {
    return <ApiTesterPlaceholder host={env.host} />;
  };
}
