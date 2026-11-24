import test from "node:test";
import assert from "node:assert/strict";
import { groqJSON, groqTranscribe } from "./providers.ts";
import { pcmToWav, offlineRedraft } from "./lib.ts";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test("groqJSON sends the right request and parses the reply", async () => {
  let seen: any;
  const f = (async (url: string, init: any) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return ok({ choices: [{ message: { content: 'Here: {"draft":"Hi."}' } }] });
  }) as any;
  const out = await groqJSON({ key: "K", model: "m1", system: "S JSON", user: "U" }, f);
  assert.deepEqual(out, { draft: "Hi." });
  assert.equal(seen.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer K");
  assert.equal(seen.body.model, "m1");
  assert.deepEqual(seen.body.response_format, { type: "json_object" });
});

test("groqJSON retries without JSON mode on a 400", async () => {
  const calls: any[] = [];
  const f = (async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    calls.push(b);
    return b.response_format ? new Response("bad", { status: 400 }) : ok({ choices: [{ message: { content: '{"a":1}' } }] });
  }) as any;
  assert.deepEqual(await groqJSON({ key: "K", model: "m", system: "s", user: "u" }, f), { a: 1 });
  assert.equal(calls.length, 2);
});

test("groqJSON throws a readable error on failure", async () => {
  const f = (async () => new Response("nope", { status: 401 })) as any;
  await assert.rejects(groqJSON({ key: "K", model: "m", system: "s", user: "u" }, f), /groq_401/);
});

test("groqTranscribe posts multipart audio and returns text", async () => {
  let seen: any;
  const f = (async (url: string, init: any) => { seen = { url, init }; return ok({ text: "  make it   shorter " }); }) as any;
  const text = await groqTranscribe({ key: "K", model: "whisper-x", wav: pcmToWav(new Uint8Array(100)), language: "en" }, f);
  assert.equal(text, "make it shorter");
  assert.equal(seen.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.ok(seen.init.body instanceof FormData);
  assert.equal(seen.init.body.get("model"), "whisper-x");
});

test("pcmToWav writes a valid 44-byte header", () => {
  const wav = Buffer.from(pcmToWav(new Uint8Array(32000)));
  assert.equal(wav.length, 32044);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 32000);
});

test("offline redraft can decline", () => {
  assert.match(offlineRedraft("Sure, works for me.", "say no politely"), /pass this time/);
});
