export interface ChunkRenderingHint {
  /** A local recommendation that the renderer can override. */
  renderHint: "image" | "text";
  /** Potential image subject; null when on-screen text is recommended. */
  visualFocus: string | null;
  renderReason: string;
}

export interface VisualCandidate {
  text: string;
  normal: string;
  kind: "noun" | "description" | "action" | "number";
  infinitive?: string;
}

// These verbs need an object or more context before they suggest an image.
// Match verb infinitives, so uses/used/using and helps/helped share a rule.
const GENERIC_ACTIONS = new Set([
  "use", "help", "make", "get", "have", "do", "need", "want", "know",
  "think", "understand", "mean", "seem", "become", "involve", "provide",
  "allow", "enable", "depend", "require", "explain", "consider", "happen",
  "occur", "represent", "include", "relate", "change", "turn", "put",
  "take", "give", "support", "try", "start", "begin", "continue",
]);

// Deliberately bounded, transparent heuristics rather than a claimed semantic
// classifier. Scientific subjects such as energy can still suggest diagrams.
const ABSTRACT_TERMS = new Set([
  "idea", "ideas", "concept", "concepts", "reason", "reasons", "way", "ways",
  "thing", "things", "stuff", "something", "anything", "everything", "nothing",
  "importance", "possibility", "possibilities", "ability", "abilities",
  "relationship", "relationships", "aspect", "aspects", "result", "results",
  "fact", "facts", "information", "knowledge", "understanding", "meaning",
  "purpose", "process", "processes", "situation", "situations", "example", "examples",
  "use", "uses", "help", "useful", "important", "possible", "necessary", "similar",
  "different", "general", "basic", "main", "overall", "actual", "particular", "relevant",
]);

export function isGenericAction(candidate: VisualCandidate): boolean {
  // Phrasal verbs can have infinitives such as "turn off" or "make use".
  const verbHead = (candidate.infinitive ?? candidate.normal).split(/\s+/u)[0]!;
  return candidate.kind === "action" && GENERIC_ACTIONS.has(verbHead);
}

export function suggestRendering(candidates: VisualCandidate[]): ChunkRenderingHint {
  const subjects = candidates.filter((candidate) => candidate.kind !== "number" &&
    !isGenericAction(candidate) && !ABSTRACT_TERMS.has(candidate.normal));
  if (subjects.length > 0) {
    return {
      renderHint: "image",
      visualFocus: subjects.map((candidate) => candidate.text).join(" "),
      renderReason: "Contains a potential visual subject, description, or action.",
    };
  }
  const reason = candidates.some((candidate) => ABSTRACT_TERMS.has(candidate.normal) && !isGenericAction(candidate))
    ? "Abstract or vague language is clearer as on-screen text."
    : candidates.some(isGenericAction)
      ? "Generic action without a specific visual subject."
      : candidates.some((candidate) => candidate.kind === "number")
        ? "A number or ordinal can be displayed directly as text."
        : "Connecting words without a clear visual subject.";
  return { renderHint: "text", visualFocus: null, renderReason: reason };
}
