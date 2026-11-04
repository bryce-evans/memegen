import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { templateSearch } from "./search.ts";

test("malformed and failing sidecar responses stay fail-soft; valid hits still rank", async (t) => {
  let body: unknown = {};
  let status = 200;
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
  });
  t.mock.method(console, "error", () => {});
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const search = templateSearch(`http://127.0.0.1:${address.port}`)!;
  const templateId = crypto.randomUUID();
  const candidates = [{ templateId, groupId: templateId }];
  for (body of [null, {}, { hits: null }, { hits: {} }, { hits: [null] }, { hits: [{ templateId, score: "3" }] }, { hits: [{ templateId: "bad", score: 3 }] }]) {
    assert.deepEqual(await search.text("dog", 48, candidates), []);
    assert.deepEqual(await search.similar(templateId, 12, candidates), []);
  }
  status = 503;
  body = { error: "unavailable" };
  assert.deepEqual(await search.text("dog", 48, candidates), []);
  status = 200;
  body = { hits: [{ templateId, score: 3.25 }] };
  assert.deepEqual(await search.text("dog", 48, candidates), [{ templateId, score: 3.25 }]);
});
