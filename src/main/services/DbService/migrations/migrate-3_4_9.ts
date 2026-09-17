import type { IOrm, ISchemas } from '@shared/types/db';
import { sql } from 'drizzle-orm';

import migratePlaybackHistory from './migrate-3_4_8';

const migrate = async (orm: IOrm, schemas: ISchemas): Promise<void> => {
  // Repair databases that already ran the original, unrestricted 3.4.8 index.
  // Previously deleted search terms can only be recovered from an older backup.
  await orm.run(sql`DROP INDEX IF EXISTS uidx_history_identity;`);
  await migratePlaybackHistory(orm, schemas);
};

export default migrate;
