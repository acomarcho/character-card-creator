"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type StreamPhase =
  | "connecting_tools"
  | "searching_web"
  | "generating"
  | "fallback"
  | "done";

type GenerationStreamEvent =
  | {
      type: "status";
      phase: StreamPhase;
      message: string;
    }
  | {
      type: "tool";
      state: "start" | "result" | "error";
      toolName: string;
    }
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "reset-output";
    }
  | {
      type: "done";
      output: string;
      usedWebTools: boolean;
      toolWarning?: string;
    }
  | {
      type: "error";
      error: string;
    };

const STORAGE_KEYS = {
  deepseekApiKey: "character-card-creator:deepseek-api-key",
  exaApiKey: "character-card-creator:exa-api-key",
  characterName: "character-card-creator:character-name",
  characterContext: "character-card-creator:character-context",
  openingContext: "character-card-creator:opening-context",
};

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      return data.error;
    }
  } catch {
    return "Something went wrong while contacting the generation API.";
  }

  return "Something went wrong while contacting the generation API.";
}

async function streamNdjson(
  response: Response,
  onEvent: (event: GenerationStreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      onEvent(JSON.parse(line) as GenerationStreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as GenerationStreamEvent);
  }
}

function renderCodeBlock(content: string): string {
  return ["```txt", content.trim(), "```"].join("\n");
}

export default function Home() {
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [exaApiKey, setExaApiKey] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [characterCard, setCharacterCard] = useState("");
  const [openingContext, setOpeningContext] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");

  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [isGeneratingOpening, setIsGeneratingOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"card" | "opening" | null>(
    null,
  );
  const [cardToolNotice, setCardToolNotice] = useState<string | null>(null);
  const [openingToolNotice, setOpeningToolNotice] = useState<string | null>(
    null,
  );
  const [cardStatus, setCardStatus] = useState<string | null>(null);
  const [openingStatus, setOpeningStatus] = useState<string | null>(null);
  const [cardToolActivity, setCardToolActivity] = useState<string[]>([]);
  const [openingToolActivity, setOpeningToolActivity] = useState<string[]>([]);

  useEffect(() => {
    setDeepseekApiKey(localStorage.getItem(STORAGE_KEYS.deepseekApiKey) ?? "");
    setExaApiKey(localStorage.getItem(STORAGE_KEYS.exaApiKey) ?? "");
    setCharacterName(localStorage.getItem(STORAGE_KEYS.characterName) ?? "");
    setCharacterContext(
      localStorage.getItem(STORAGE_KEYS.characterContext) ?? "",
    );
    setOpeningContext(localStorage.getItem(STORAGE_KEYS.openingContext) ?? "");
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.deepseekApiKey, deepseekApiKey);
  }, [deepseekApiKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.exaApiKey, exaApiKey);
  }, [exaApiKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.characterName, characterName);
  }, [characterName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.characterContext, characterContext);
  }, [characterContext]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.openingContext, openingContext);
  }, [openingContext]);

  async function handleGenerateCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCardToolNotice(null);
    setCardToolActivity([]);
    setCardStatus("Preparing generation...");

    if (!deepseekApiKey.trim()) {
      setError("Please provide your DeepSeek API key.");
      return;
    }

    if (!characterName.trim()) {
      setError("Please provide a character name.");
      return;
    }

    setIsGeneratingCard(true);

    try {
      const response = await fetch("/api/generate-character-card", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deepseekApiKey,
          exaApiKey,
          characterName,
          characterContext,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      setCharacterCard("");
      setOpeningMessage("");

      await streamNdjson(response, (eventData) => {
        if (eventData.type === "status") {
          setCardStatus(eventData.message);
          return;
        }

        if (eventData.type === "tool") {
          const toolText =
            eventData.state === "start"
              ? `Calling ${eventData.toolName}...`
              : eventData.state === "result"
                ? `Received ${eventData.toolName} results.`
                : `${eventData.toolName} returned an error.`;

          setCardToolActivity((current) => [...current, toolText]);
          return;
        }

        if (eventData.type === "reset-output") {
          setCharacterCard("");
          return;
        }

        if (eventData.type === "text-delta") {
          setCharacterCard((current) => current + eventData.delta);
          return;
        }

        if (eventData.type === "done") {
          setCharacterCard(eventData.output);

          if (eventData.toolWarning) {
            setCardToolNotice(eventData.toolWarning);
          } else if (eventData.usedWebTools) {
            setCardToolNotice("Web search tools were used for this generation.");
          } else {
            setCardToolNotice(null);
          }
          return;
        }

        if (eventData.type === "error") {
          throw new Error(eventData.error);
        }
      });
    } catch (unknownError) {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Character card generation failed.";

      setError(message);
    } finally {
      setIsGeneratingCard(false);
      setCardStatus(null);
    }
  }

  async function handleGenerateOpeningMessage() {
    setError(null);
    setOpeningToolNotice(null);
    setOpeningToolActivity([]);
    setOpeningStatus("Preparing generation...");

    if (!deepseekApiKey.trim()) {
      setError("Please provide your DeepSeek API key.");
      return;
    }

    if (!characterName.trim()) {
      setError("Please provide a character name.");
      return;
    }

    if (!characterCard.trim()) {
      setError("Generate a character card before generating an opening message.");
      return;
    }

    setIsGeneratingOpening(true);

    try {
      const response = await fetch("/api/generate-opening-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deepseekApiKey,
          exaApiKey,
          characterName,
          characterCard,
          openingContext,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      setOpeningMessage("");

      await streamNdjson(response, (eventData) => {
        if (eventData.type === "status") {
          setOpeningStatus(eventData.message);
          return;
        }

        if (eventData.type === "tool") {
          const toolText =
            eventData.state === "start"
              ? `Calling ${eventData.toolName}...`
              : eventData.state === "result"
                ? `Received ${eventData.toolName} results.`
                : `${eventData.toolName} returned an error.`;

          setOpeningToolActivity((current) => [...current, toolText]);
          return;
        }

        if (eventData.type === "reset-output") {
          setOpeningMessage("");
          return;
        }

        if (eventData.type === "text-delta") {
          setOpeningMessage((current) => current + eventData.delta);
          return;
        }

        if (eventData.type === "done") {
          setOpeningMessage(eventData.output);

          if (eventData.toolWarning) {
            setOpeningToolNotice(eventData.toolWarning);
          } else if (eventData.usedWebTools) {
            setOpeningToolNotice(
              "Web search tools were used for this generation.",
            );
          } else {
            setOpeningToolNotice(null);
          }
          return;
        }

        if (eventData.type === "error") {
          throw new Error(eventData.error);
        }
      });
    } catch (unknownError) {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Opening message generation failed.";

      setError(message);
    } finally {
      setIsGeneratingOpening(false);
      setOpeningStatus(null);
    }
  }

  async function handleCopy(
    value: string,
    field: "card" | "opening",
  ): Promise<void> {
    if (!value.trim()) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedField(field);

    window.setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
    }, 1400);
  }

  const canGenerateCard = useMemo(
    () => Boolean(deepseekApiKey.trim() && characterName.trim()),
    [deepseekApiKey, characterName],
  );

  const canGenerateOpening = useMemo(
    () =>
      Boolean(
        deepseekApiKey.trim() && characterName.trim() && characterCard.trim(),
      ),
    [deepseekApiKey, characterName, characterCard],
  );

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-10 text-zinc-100 sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(131,24,67,0.25),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(37,99,235,0.22),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,0.2),transparent_45%)]" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-white/15 bg-zinc-950/75 p-6 shadow-[0_20px_90px_-42px_rgba(236,72,153,0.7)] backdrop-blur-sm sm:p-8">
          <p className="mb-2 text-xs uppercase tracking-[0.22em] text-pink-300">
            SillyTavern Utility
          </p>
          <h1 className="font-display text-4xl leading-tight text-zinc-50 sm:text-5xl">
            Character Card Creator
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-zinc-300 sm:text-base">
            Generate roleplay-ready character cards and opening messages with
            agentic web research using Vercel AI SDK + DeepSeek + Exa MCP.
          </p>
        </section>

        <section className="grid gap-4 rounded-3xl border border-white/10 bg-zinc-950/65 p-5 backdrop-blur sm:grid-cols-2 sm:p-6">
          <label className="space-y-2">
            <span className="block text-sm font-semibold text-zinc-100">
              DeepSeek API Key (saved in localStorage)
            </span>
            <input
              type="password"
              value={deepseekApiKey}
              onChange={(event) => setDeepseekApiKey(event.target.value)}
              placeholder="sk-..."
              className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-pink-400/40 transition focus:ring"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-semibold text-zinc-100">
              Exa API Key (optional, saved in localStorage)
            </span>
            <input
              type="password"
              value={exaApiKey}
              onChange={(event) => setExaApiKey(event.target.value)}
              placeholder="exa_..."
              className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-pink-400/40 transition focus:ring"
            />
          </label>
        </section>

        <section className="rounded-3xl border border-white/10 bg-zinc-950/65 p-5 backdrop-blur sm:p-6">
          <h2 className="font-display text-2xl text-zinc-50">
            1) Generate Character Card
          </h2>

          <form className="mt-7 grid gap-7" onSubmit={handleGenerateCard}>
            <label className="flex flex-col gap-3">
              <span className="block text-sm font-semibold text-zinc-100">
                Character Name
              </span>
              <input
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                placeholder="Sae Niijima"
                className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-pink-400/40 transition focus:ring"
              />
            </label>

            <label className="flex flex-col gap-3">
              <span className="block text-sm font-semibold text-zinc-100">
                Character Starting Context
              </span>
              <textarea
                value={characterContext}
                onChange={(event) => setCharacterContext(event.target.value)}
                placeholder="Add in some starting context for who your character is (e.g. character is from Persona 5 Royal)."
                rows={4}
                className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-pink-400/40 transition focus:ring"
              />
            </label>

            <button
              type="submit"
              disabled={isGeneratingCard || !canGenerateCard}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingCard
                ? "Generating Character Card..."
                : "Generate Character Card"}
            </button>

            {cardStatus ? (
              <p className="rounded-xl border border-indigo-300/20 bg-indigo-950/35 px-3 py-2 text-xs text-indigo-100">
                {cardStatus}
              </p>
            ) : null}

            {cardToolActivity.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-zinc-900/55 px-3 py-2 text-xs text-zinc-200">
                {cardToolActivity.slice(-4).join(" · ")}
              </div>
            ) : null}
          </form>

          {cardToolNotice ? (
            <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
              {cardToolNotice}
            </p>
          ) : null}

          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                Generated Character Card
              </h3>
              <button
                type="button"
                onClick={() => handleCopy(characterCard, "card")}
                disabled={!characterCard.trim()}
                className="rounded-lg border border-white/20 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedField === "card" ? "Copied" : "Copy to Clipboard"}
              </button>
            </div>

            <pre className="max-h-[26rem] overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-4 text-xs leading-relaxed text-zinc-200 sm:text-sm">
              {characterCard.trim()
                ? renderCodeBlock(characterCard)
                : "```txt\nGenerate a character card to see output here.\n```"}
            </pre>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-zinc-950/65 p-5 backdrop-blur sm:p-6">
          <h2 className="font-display text-2xl text-zinc-50">
            2) Generate Opening Message
          </h2>

          <label className="mt-6 flex flex-col gap-3">
            <span className="block text-sm font-semibold text-zinc-100">
              Opening Message Context
            </span>
            <textarea
              value={openingContext}
              onChange={(event) => setOpeningContext(event.target.value)}
              placeholder="Make it so that the character and user do not know each other yet."
              rows={3}
              className="w-full rounded-xl border border-white/15 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-pink-400/40 transition focus:ring"
            />
          </label>

          <button
            type="button"
            disabled={isGeneratingOpening || !canGenerateOpening}
            onClick={handleGenerateOpeningMessage}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGeneratingOpening
              ? "Generating Opening Message..."
              : "Generate Opening Message"}
          </button>

          {openingStatus ? (
            <p className="mt-4 rounded-xl border border-indigo-300/20 bg-indigo-950/35 px-3 py-2 text-xs text-indigo-100">
              {openingStatus}
            </p>
          ) : null}

          {openingToolActivity.length > 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-zinc-900/55 px-3 py-2 text-xs text-zinc-200">
              {openingToolActivity.slice(-4).join(" · ")}
            </div>
          ) : null}

          {openingToolNotice ? (
            <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
              {openingToolNotice}
            </p>
          ) : null}

          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                Generated Opening Message
              </h3>
              <button
                type="button"
                onClick={() => handleCopy(openingMessage, "opening")}
                disabled={!openingMessage.trim()}
                className="rounded-lg border border-white/20 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedField === "opening" ? "Copied" : "Copy to Clipboard"}
              </button>
            </div>

            <pre className="max-h-[24rem] overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-4 text-xs leading-relaxed text-zinc-200 sm:text-sm">
              {openingMessage.trim()
                ? renderCodeBlock(openingMessage)
                : "```txt\nGenerate an opening message to see output here.\n```"}
            </pre>
          </div>
        </section>

        {error ? (
          <p className="rounded-2xl border border-rose-400/30 bg-rose-900/50 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
