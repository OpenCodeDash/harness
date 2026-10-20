import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface CampaignRecord {
  id: string;
  name: string;
  prompt: string;
  domain: string;
  pack: string;
  dir: string;
  createdAt: string;
}

type Row = Record<string, unknown>;

export class CampaignRegistry {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        domain TEXT NOT NULL,
        pack TEXT NOT NULL,
        dir TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  create(input: Omit<CampaignRecord, "createdAt">): CampaignRecord {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO campaign (id, name, prompt, domain, pack, dir, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.prompt,
        input.domain,
        input.pack,
        input.dir,
        createdAt,
      );
    return { ...input, createdAt };
  }

  list(): CampaignRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM campaign ORDER BY created_at")
      .all() as Row[];
    return rows.map(toRecord);
  }

  get(id: string): CampaignRecord | null {
    const row = this.db
      .prepare("SELECT * FROM campaign WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

function toRecord(row: Row): CampaignRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prompt: String(row.prompt),
    domain: String(row.domain),
    pack: String(row.pack),
    dir: String(row.dir),
    createdAt: String(row.created_at),
  };
}
