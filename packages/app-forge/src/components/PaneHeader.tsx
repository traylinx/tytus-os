import { styles } from '../forgeStyles';

export function PaneHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={styles.paneHeader}>
      <span>{title}</span>
      <span style={styles.countBadge}>{count}</span>
    </div>
  );
}
