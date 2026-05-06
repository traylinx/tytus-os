import type { AppDb, HostClient } from '@tytus/host-api';
import { WorkbenchShell } from './workbench/components/WorkbenchShell';
import './workbench/workbench.css';

interface ForgeProps {
  db: AppDb;
  host: HostClient;
}

export function Forge({ host }: ForgeProps) {
  return <WorkbenchShell host={host} />;
}
