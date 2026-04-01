"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type TimelineTone = "info" | "success" | "warning" | "error";

type TimelineItem = {
  id: number;
  message: string;
  tone: TimelineTone;
};

const STORAGE_KEYS = {
  deepseekApiKey: "character-card-creator:deepseek-api-key",
  exaApiKey: "character-card-creator:exa-api-key",
  characterName: "character-card-creator:character-name",
  characterContext: "character-card-creator:character-context",
  openingContext: "character-card-creator:opening-context",
  characterCardManualEdit: "character-card-creator:character-card-manual-edit",
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

function toneForPhase(phase: StreamPhase): TimelineTone {
  switch (phase) {
    case "done":
      return "success";
    case "fallback":
      return "warning";
    case "connecting_tools":
    case "searching_web":
    case "generating":
      return "info";
    default:
      return "info";
  }
}

function toneClasses(tone: TimelineTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-300";
    case "warning":
      return "bg-amber-300";
    case "error":
      return "bg-rose-300";
    case "info":
    default:
      return "bg-indigo-300";
  }
}

function StreamingTimeline({
  items,
  isActive,
}: {
  items: TimelineItem[];
  isActive: boolean;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/55 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
        Live Timeline
      </p>
      <ol className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={item.id} className="relative flex gap-3">
            {index !== items.length - 1 ? (
              <span className="absolute left-[5px] top-3 h-[calc(100%+0.6rem)] w-px bg-white/15" />
            ) : null}
            <span
              className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${toneClasses(item.tone)}`}
            />
            <p className="min-w-0 text-xs leading-relaxed break-words text-zinc-100">
              {item.message}
            </p>
          </li>
        ))}
      </ol>
      {isActive ? (
        <p className="mt-3 text-xs text-indigo-200">Streaming in progress...</p>
      ) : null}
    </div>
  );
}

export default function Home() {
  const timelineIdRef = useRef(0);

  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [exaApiKey, setExaApiKey] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [characterCard, setCharacterCard] = useState("");
  const [isCharacterCardManualEdit, setIsCharacterCardManualEdit] =
    useState(false);
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
  const [cardTimeline, setCardTimeline] = useState<TimelineItem[]>([]);
  const [openingTimeline, setOpeningTimeline] = useState<TimelineItem[]>([]);

  function nextTimelineId(): number {
    timelineIdRef.current += 1;
    return timelineIdRef.current;
  }

  function appendCardTimeline(message: string, tone: TimelineTone = "info") {
    setCardTimeline((current) => {
      if (current.at(-1)?.message === message) {
        return current;
      }

      return [...current.slice(-11), { id: nextTimelineId(), message, tone }];
    });
  }

  function appendOpeningTimeline(
    message: string,
    tone: TimelineTone = "info",
  ) {
    setOpeningTimeline((current) => {
      if (current.at(-1)?.message === message) {
        return current;
      }

      return [...current.slice(-11), { id: nextTimelineId(), message, tone }];
    });
  }

  useEffect(() => {
    setDeepseekApiKey(localStorage.getItem(STORAGE_KEYS.deepseekApiKey) ?? "");
    setExaApiKey(localStorage.getItem(STORAGE_KEYS.exaApiKey) ?? "");
    setCharacterName(localStorage.getItem(STORAGE_KEYS.characterName) ?? "");
    setCharacterContext(
      localStorage.getItem(STORAGE_KEYS.characterContext) ?? "",
    );
    setIsCharacterCardManualEdit(
      localStorage.getItem(STORAGE_KEYS.characterCardManualEdit) === "true",
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
    localStorage.setItem(
      STORAGE_KEYS.characterCardManualEdit,
      String(isCharacterCardManualEdit),
    );
  }, [isCharacterCardManualEdit]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.openingContext, openingContext);
  }, [openingContext]);

  async function handleGenerateCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCardToolNotice(null);
    setCardTimeline([
      {
        id: nextTimelineId(),
        message: "Preparing generation...",
        tone: "info",
      },
    ]);

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
          appendCardTimeline(eventData.message, toneForPhase(eventData.phase));
          return;
        }

        if (eventData.type === "tool") {
          const toolText =
            eventData.state === "start"
              ? `Calling ${eventData.toolName}...`
              : eventData.state === "result"
                ? `Received ${eventData.toolName} results.`
                : `${eventData.toolName} returned an error.`;

          appendCardTimeline(
            toolText,
            eventData.state === "result"
              ? "success"
              : eventData.state === "error"
                ? "error"
                : "info",
          );
          return;
        }

        if (eventData.type === "reset-output") {
          setCharacterCard("");
          appendCardTimeline(
            "Restarted generation without tools.",
            "warning",
          );
          return;
        }

        if (eventData.type === "text-delta") {
          setCharacterCard((current) => current + eventData.delta);
          return;
        }

        if (eventData.type === "done") {
          setCharacterCard(eventData.output);
          appendCardTimeline("Final output is ready.", "success");

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
      appendCardTimeline(message, "error");
    } finally {
      setIsGeneratingCard(false);
    }
  }

  async function handleGenerateOpeningMessage() {
    setError(null);
    setOpeningToolNotice(null);
    setOpeningTimeline([
      {
        id: nextTimelineId(),
        message: "Preparing generation...",
        tone: "info",
      },
    ]);

    if (!deepseekApiKey.trim()) {
      setError("Please provide your DeepSeek API key.");
      return;
    }

    if (!characterName.trim()) {
      setError("Please provide a character name.");
      return;
    }

    if (!characterCard.trim()) {
      setError(
        "Generate or paste a character card before generating an opening message.",
      );
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
          appendOpeningTimeline(eventData.message, toneForPhase(eventData.phase));
          return;
        }

        if (eventData.type === "tool") {
          const toolText =
            eventData.state === "start"
              ? `Calling ${eventData.toolName}...`
              : eventData.state === "result"
                ? `Received ${eventData.toolName} results.`
                : `${eventData.toolName} returned an error.`;

          appendOpeningTimeline(
            toolText,
            eventData.state === "result"
              ? "success"
              : eventData.state === "error"
                ? "error"
                : "info",
          );
          return;
        }

        if (eventData.type === "reset-output") {
          setOpeningMessage("");
          appendOpeningTimeline(
            "Restarted generation without tools.",
            "warning",
          );
          return;
        }

        if (eventData.type === "text-delta") {
          setOpeningMessage((current) => current + eventData.delta);
          return;
        }

        if (eventData.type === "done") {
          setOpeningMessage(eventData.output);
          appendOpeningTimeline("Final output is ready.", "success");

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
      appendOpeningTimeline(message, "error");
    } finally {
      setIsGeneratingOpening(false);
    }
  }

  async function handleCopy(
    value: string,
    field: "card" | "opening",
  ): Promise<void> {
    if (!value || !value.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

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

            <StreamingTimeline
              items={cardTimeline}
              isActive={isGeneratingCard}
            />
          </form>

          {cardToolNotice ? (
            <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
              {cardToolNotice}
            </p>
          ) : null}

          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                Character Card
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={isCharacterCardManualEdit}
                    onChange={(event) =>
                      setIsCharacterCardManualEdit(event.target.checked)
                    }
                    className="h-3.5 w-3.5 rounded border-white/20 bg-zinc-950 text-pink-400 accent-pink-400"
                  />
                  Manual edit
                </label>

                <button
                  type="button"
                  onClick={() => handleCopy(characterCard, "card")}
                  disabled={!characterCard.trim()}
                  className="rounded-lg border border-white/20 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copiedField === "card" ? "Copied" : "Copy to Clipboard"}
                </button>
              </div>
            </div>

            <textarea
              value={characterCard}
              onChange={(event) => setCharacterCard(event.target.value)}
              readOnly={!isCharacterCardManualEdit || isGeneratingCard}
              spellCheck={false}
              placeholder="Generate a character card to see output here, or enable manual edit to paste one."
              rows={16}
              className="min-h-[26rem] w-full rounded-2xl border border-white/10 bg-zinc-900/95 p-4 font-mono text-xs leading-relaxed text-zinc-200 outline-none ring-pink-400/40 transition focus:ring read-only:cursor-default read-only:text-zinc-300/90 sm:text-sm"
            />
            <p className="text-xs text-zinc-400">
              {isCharacterCardManualEdit
                ? isGeneratingCard
                  ? "Manual editing is temporarily locked while generation is streaming."
                  : "Manual editing is on. You can paste an existing character card here."
                : "Manual editing is off. This field still updates from generation and streaming events."}
            </p>
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

          <div className="mt-4">
            <StreamingTimeline
              items={openingTimeline}
              isActive={isGeneratingOpening}
            />
          </div>

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
