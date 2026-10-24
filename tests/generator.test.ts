import assert from "node:assert/strict";
import test from "node:test";
import { generateScript, MAX_SOURCE_CHARACTERS } from "../src/generator.js";
import type { ScriptOptions } from "../src/generator.js";

const requestOptions = {
  apiKey: "test-key",
  model: "test-model",
  baseUrl: "https://api.openai.com/v1",
};

function scriptResponse(content: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content }, ...extra }],
  });
}

test("generation makes one structured-output request and returns validated narration", async (t) => {
  const sourceText = "Energy cannot be created or destroyed.\nIt can change forms.";
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(input, "https://api.openai.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(typeof init?.body, "string");
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, "test-model");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    assert.deepEqual(JSON.parse(body.messages[1].content), {
      audience: "first-year physics students",
      targetWords: 120,
      sourceText,
    });
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["title", "script"]);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.deepEqual(body.response_format.json_schema.schema.properties, {
      title: { type: "string" },
      script: { type: "string" },
    });
    return scriptResponse(JSON.stringify({
      title: "  Energy's Day Job  ",
      script: "  Energy changes forms.\nIt never clocks out.  ",
    }));
  });

  const result = await generateScript(sourceText, {
    ...requestOptions,
    targetWords: 120,
    audience: " first-year physics students ",
    baseUrl: "https://api.openai.com/v1/",
  });

  assert.deepEqual(result, {
    title: "Energy's Day Job",
    script: "Energy changes forms.\nIt never clocks out.",
    model: "test-model",
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("invalid source and options are rejected before any API request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  const cases: { source: string; options: ScriptOptions; error: RegExp }[] = [
    { source: " \n ", options: {}, error: /source text.*empty/i },
    { source: "a".repeat(MAX_SOURCE_CHARACTERS + 1), options: {}, error: /source text exceeds/i },
    { source: "Lesson", options: { targetWords: 49 }, error: /targetWords/ },
    { source: "Lesson", options: { targetWords: 100.5 }, error: /targetWords/ },
    { source: "Lesson", options: { timeoutMs: 0 }, error: /timeoutMs/ },
    { source: "Lesson", options: { audience: "  " }, error: /audience/ },
    { source: "Lesson", options: { model: "  " }, error: /model.*empty/i },
    { source: "Lesson", options: { apiKey: "" }, error: /OPENAI_API_KEY/ },
    { source: "Lesson", options: { baseUrl: "not a URL" }, error: /absolute API URL/ },
    { source: "Lesson", options: { baseUrl: "http://example.com/v1" }, error: /HTTPS/ },
    { source: "Lesson", options: { baseUrl: "https://user:secret@example.com/v1" }, error: /credentials/ },
    { source: "Lesson", options: { baseUrl: "https://example.com/v1?token=secret" }, error: /query string/ },
  ];

  for (const { source, options, error } of cases) {
    await assert.rejects(generateScript(source, { ...requestOptions, ...options }), error);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a non-JSON provider response is reported clearly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Service error</html>"));
  await assert.rejects(generateScript("Lesson", requestOptions), /invalid JSON response/);
});

test("missing choices and script content are rejected", async (t) => {
  const cases: { name: string; response: () => Response; error: RegExp }[] = [
    { name: "no choices", response: () => Response.json({ choices: [] }), error: /no script choice/ },
    { name: "null content", response: () => scriptResponse(null), error: /no script content/ },
    { name: "empty content", response: () => scriptResponse(""), error: /not valid JSON/ },
    { name: "malformed content", response: () => scriptResponse("{\"title\": " ), error: /not valid JSON/ },
    { name: "blank narration", response: () => scriptResponse(JSON.stringify({ title: "Title", script: " \n " })), error: /nonempty title and narration/ },
    { name: "missing title", response: () => scriptResponse(JSON.stringify({ script: "Narration" })), error: /nonempty title and narration/ },
  ];
  for (const { name, response, error } of cases) {
    await t.test(name, async (subtest) => {
      subtest.mock.method(globalThis, "fetch", async () => response());
      await assert.rejects(generateScript("Lesson", requestOptions), error);
    });
  }
});

test("model refusals and interrupted completions never become usable scripts", async (t) => {
  const content = JSON.stringify({ title: "Title", script: "Plausible but incomplete narration." });
  const cases = [
    { name: "refusal", extra: { message: { content, refusal: "Unavailable" } }, error: /declined/ },
    { name: "token limit", extra: { finish_reason: "length" }, error: /cut off.*token limit/ },
    { name: "content filter", extra: { finish_reason: "content_filter" }, error: /did not finish/ },
  ];
  for (const { name, extra, error } of cases) {
    await t.test(name, async (subtest) => {
      subtest.mock.method(globalThis, "fetch", async () => scriptResponse(content, extra));
      await assert.rejects(generateScript("Lesson", requestOptions), error);
    });
  }
});

test("HTTP failures explain authentication and rate limits without exposing provider bodies", async (t) => {
  for (const { status, hint } of [
    { status: 401, hint: /OPENAI_API_KEY/ },
    { status: 429, hint: /quota or rate limit/ },
  ]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      subtest.mock.method(globalThis, "fetch", async () => new Response("PRIVATE SOURCE AND SECRET", { status }));
      await assert.rejects(generateScript("Lesson", requestOptions), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, hint);
        assert.doesNotMatch(error.message, /PRIVATE SOURCE|SECRET/);
        return true;
      });
    });
  }
});

test("network failures give a connection diagnostic", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(generateScript("Lesson", requestOptions), /Could not reach the OpenAI API/);
});

test("the timeout aborts a pending request and reports the configured duration", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal;
    assert.ok(requestSignal);
    requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const request = generateScript("Lesson", { ...requestOptions, timeoutMs: 25 });
  const rejection = assert.rejects(request, /timed out after 25 ms/);
  t.mock.timers.tick(25);
  await rejection;
  assert.equal(requestSignal?.aborted, true);
});
