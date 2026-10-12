import { crc32, deflateSync } from "node:zlib";
import { createSql, type Sql } from "./db.ts";
import { migrate } from "./migrate.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/memegen_test";

/** Fresh schema in the test database. Test files run serially (--test-concurrency=1). */
export async function freshTestDb(): Promise<Sql> {
  const sql = createSql(TEST_DATABASE_URL);
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  return sql;
}

/** Minimal 8-bit RGB PNG. `rgb` holds width*height*3 bytes, row-major; omitted means all black. */
export function encodePng(width: number, height: number, rgb?: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height); // each row: filter byte 0, then pixels
  if (rgb) for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
