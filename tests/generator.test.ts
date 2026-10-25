import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { generateScript, MAX_SOURCE_CHARACTERS } from "../src/generator.js";
import type { ScriptOptions } from "../src/generator.js";
import type { LlmProvider } from "../src/index.js";

const requestOptions = {
  provider: "openai" as const,
  apiKey: "test-key",
  model: "test-model",
  baseUrl: "https://api.openai.com/v1",
};

const providerEnvironmentKeys = [
  "LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL",
  "GROQ_API_KEY", "GROQ_MODEL", "GROQ_BASE_URL",
];

let previousValues = new Map<string, string | undefined>();

beforeEach(() => {
  previousValues = new Map(providerEnvironmentKeys.map((key) => [key, process.env[key]]));
  for (const key of providerEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of previousValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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
    assert.equal(body.reasoning_effort, undefined);
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
    provider: "openai",
    model: "test-model",
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("Groq is the default and receives a single strict structured-output request", async (t) => {
  process.env.GROQ_API_KEY = "groq-test-key";
  process.env.OPENAI_API_KEY = "unused-openai-key";
  process.env.OPENAI_MODEL = "unused-openai-model";
  process.env.OPENAI_BASE_URL = "https://unused-openai.example/v1";
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(input, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer groq-test-key");
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["title", "script"]);
    return scriptResponse(JSON.stringify({ title: "A Leaf's Lunch", script: "Leaves turn light into lunch." }));
  });

  const result = await generateScript("Leaves capture light.");
  assert.equal(result.provider, "groq");
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.script, "Leaves turn light into lunch.");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("provider-specific environment configuration and explicit options stay isolated", async (t) => {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "openai-env-key";
  process.env.OPENAI_MODEL = "openai-env-model";
  process.env.OPENAI_BASE_URL = "https://openai.example/v1";
  process.env.GROQ_API_KEY = "groq-env-key";
  process.env.GROQ_MODEL = "groq-env-model";
  process.env.GROQ_BASE_URL = "https://groq.example/openai/v1";
  const requests: { url: unknown; key: string | null; model: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requests.push({
      url: input,
      key: new Headers(init?.headers).get("authorization"),
      model: JSON.parse(init?.body as string).model,
    });
    return scriptResponse(JSON.stringify({ title: "Lesson", script: "Leaves capture light." }));
  });

  assert.equal((await generateScript("Lesson")).provider, "openai");
  assert.equal((await generateScript("Lesson", { provider: "groq" })).provider, "groq");
  assert.equal((await generateScript("Lesson", {
    provider: "groq", apiKey: "explicit-key", model: "explicit-model", baseUrl: "https://explicit.example/v1",
  })).provider, "groq");
  assert.deepEqual(requests, [
    { url: "https://openai.example/v1/chat/completions", key: "Bearer openai-env-key", model: "openai-env-model" },
    { url: "https://groq.example/openai/v1/chat/completions", key: "Bearer groq-env-key", model: "groq-env-model" },
    { url: "https://explicit.example/v1/chat/completions", key: "Bearer explicit-key", model: "explicit-model" },
  ]);
});

test("a missing Groq key or invalid provider never uses an available OpenAI key", async (t) => {
  process.env.OPENAI_API_KEY = "unused-openai-key";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  await assert.rejects(generateScript("Lesson"), /GROQ_API_KEY/);
  await assert.rejects(generateScript("Lesson", {
    provider: "unsupported" as LlmProvider,
    apiKey: "test-key",
  }), /provider/i);
  process.env.LLM_PROVIDER = "unsupported";
  await assert.rejects(generateScript("Lesson", { apiKey: "test-key" }), /provider/i);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a Groq quota error makes no retry or paid-provider fallback", async (t) => {
  process.env.GROQ_API_KEY = "groq-test-key";
  process.env.OPENAI_API_KEY = "unused-openai-key";
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    assert.equal(input, "https://api.groq.com/openai/v1/chat/completions");
    return new Response("PRIVATE SOURCE AND SECRET", { status: 429 });
  });
  await assert.rejects(generateScript("Lesson"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Groq/);
    assert.match(error.message, /HTTP 429/);
    assert.match(error.message, /quota or rate limit/);
    assert.doesNotMatch(error.message, /PRIVATE SOURCE|SECRET/);
    return true;
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

test("topic generation explicitly uses general knowledge while material mode stays unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(init?.body as string);
    assert.match(body.messages[0].content, /sourceText describes a topic to teach/);
    assert.match(body.messages[0].content, /Use established general knowledge/);
    assert.equal(JSON.parse(body.messages[1].content).sourceText, "Explain mitochondria to a 7th grader.");
    return scriptResponse(JSON.stringify({ title: "Tiny Power Department", script: "Mitochondria help make ATP." }));
  });
  const result = await generateScript("Explain mitochondria to a 7th grader.", { ...requestOptions, inputMode: "topic" });
  assert.equal(result.title, "Tiny Power Department");
});
