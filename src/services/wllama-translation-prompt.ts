export interface TranslationPrompts {
  system: string;
  completion: string;
  maxTokens: number;
}

const languageName = (languageCode: string): string => {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) ||
      languageCode
    );
  } catch {
    return languageCode;
  }
};

export const createTranslationPrompts = (
  text: string,
  targetLang: string,
): TranslationPrompts => {
  const targetLanguage = languageName(targetLang);
  const system = [
    "You are a precise translation engine.",
    `Translate the user's text into ${targetLanguage} (${targetLang}).`,
    "Return only the translated text, without quotes, labels, notes, or markdown fences.",
    "Preserve line breaks, URLs, nostr identifiers, hashtags, emoji, and @mentions exactly.",
    "If the text is already in the target language, return it unchanged.",
  ].join(" ");

  return {
    system,
    completion: [
      system,
      "",
      "Text to translate:",
      "<text>",
      text,
      "</text>",
      "",
      "Translation:",
    ].join("\n"),
    maxTokens: Math.min(
      1024,
      Math.max(128, Math.ceil(text.length * 1.5)),
    ),
  };
};

export const cleanTranslation = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:translation|translated text)\s*:\s*/i, "")
    .trim();
