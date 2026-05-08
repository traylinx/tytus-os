import type { Db } from '@/lib/db/types';
import { SCHEMA_V14 } from '@/lib/db/schema';

export const ensureAiSchema = async (db: Db): Promise<void> => {
  await db.exec(SCHEMA_V14);
};
