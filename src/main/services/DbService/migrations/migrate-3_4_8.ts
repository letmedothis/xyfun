import type { IOrm, ISchemas } from '@shared/types/db';
import { sql } from 'drizzle-orm';

const migrate = async (orm: IOrm, _schemas: ISchemas): Promise<void> => {
  await orm.run(sql`
    DELETE FROM tbl_history
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY type, relateId, videoId
            ORDER BY updatedAt DESC, createdAt DESC, id DESC
          ) AS rowNumber
        FROM tbl_history
        WHERE type IN (1, 2, 3) AND relateId IS NOT NULL AND videoId IS NOT NULL
      )
      WHERE rowNumber > 1
    );
  `);

  await orm.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_history_identity
    ON tbl_history(type, relateId, videoId) WHERE type IN (1, 2, 3);
  `);
};

export default migrate;
