import { WllamaService } from "wllama-service";

export type WllamaTranslationStatus = "idle" | "loading" | "ready" | "error";

export interface WllamaTranslationState {
  status: WllamaTranslationStatus;
  progress: number;
  modelName: string;
  usedWebGPU: boolean;
  error: string | null;
  lastGenerationError: string | null;
}

export interface WllamaTranslationResult {
  success: boolean;
  data?: {
    detectedLang: string;
    needsTranslation: boolean;
    translation: string;
  };
  error?: string;
}

const publicUrl = process.env.PUBLIC_URL || "";
const canUseWebGPU =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  window.crossOriginIsolated &&
  "gpu" in navigator;

/**
 * Owns the single in-browser model instance used by every poll card.
 *
 * GGUF models are intentionally session-scoped: retaining a user-selected
 * multi-hundred-megabyte File in localStorage is not possible, and silently
 * duplicating it in IndexedDB would consume a surprising amount of storage.
 */
class BrowserTranslationService {
  private readonly service = new WllamaService({
    wasmPath: `${publicUrl}/wllama/wllama.wasm`,
    nCtx: 2048,
    // wllama's WebGPU runtime requires cross-origin isolation. Force the
    // reliable WASM path when the host does not send COOP/COEP headers.
    nGpuLayers: canUseWebGPU ? 999 : 0,
  });

  private state: WllamaTranslationState = {
    status: "idle",
    progress: 0,
    modelName: "",
    usedWebGPU: false,
    error: null,
    lastGenerationError: null,
  };

  private readonly listeners = new Set<() => void>();
  private generationQueue: Promise<void> = Promise.resolve();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): WllamaTranslationState => this.state;

  getEnvironment() {
    return this.service.checkEnvironment();
  }

  async loadModel(file: File): Promise<boolean> {
    if (!file.name.toLowerCase().endsWith(".gguf")) {
      this.setState({
        status: "error",
        progress: 0,
        modelName: "",
        usedWebGPU: false,
        error: "Choose a GGUF model file.",
        lastGenerationError: null,
      });
      return false;
    }

    this.setState({
      status: "loading",
      progress: 0,
      modelName: file.name,
      usedWebGPU: false,
      error: null,
      lastGenerationError: null,
    });

    const result = await this.service.loadModel(file, (progress) => {
      this.setState({ ...this.state, progress });
    });

    if (!result.success) {
      this.setState({
        status: "error",
        progress: 0,
        modelName: "",
        usedWebGPU: false,
        error: result.error || "Failed to load the model.",
        lastGenerationError: null,
      });
      return false;
    }

    this.setState({
      status: "ready",
      progress: 100,
      modelName: this.service.currentModel || file.name,
      usedWebGPU: result.usedWebGPU === true,
      error: null,
      lastGenerationError: null,
    });
    return true;
  }

  async unload(): Promise<void> {
    await this.service.unload();
    this.setState({
      status: "idle",
      progress: 0,
      modelName: "",
      usedWebGPU: false,
      error: null,
      lastGenerationError: null,
    });
  }

  translateText(params: {
    text: string;
    targetLang: string;
  }): Promise<WllamaTranslationResult> {
    const task = this.generationQueue.then(() => this.runTranslation(params));
    this.generationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async runTranslation(params: {
    text: string;
    targetLang: string;
  }): Promise<WllamaTranslationResult> {
    if (!this.service.isLoaded) {
      return {
        success: false,
        error: "Load a browser translation model in Settings → AI first.",
      };
    }

    if (!params.text.trim()) {
      return {
        success: true,
        data: {
          detectedLang: "unknown",
          needsTranslation: false,
          translation: params.text,
        },
      };
    }

    const targetLanguage = this.languageName(params.targetLang);
    const maxTokens = Math.min(
      1024,
      Math.max(128, Math.ceil(params.text.length * 1.5)),
    );
    const systemPrompt = [
      "You are a precise translation engine.",
      `Translate the user's text into ${targetLanguage} (${params.targetLang}).`,
      "Return only the translated text, without quotes, labels, notes, or markdown fences.",
      "Preserve line breaks, URLs, nostr identifiers, hashtags, emoji, and @mentions exactly.",
      "If the text is already in the target language, return it unchanged.",
    ].join(" ");

    // Prefer the model's embedded chat template. Some otherwise valid GGUF
    // models do not include one (or reject a system role), so retry as a raw
    // completion with a fully formatted prompt before reporting failure.
    const chatResult = await this.service.generate({
      system: systemPrompt,
      prompt: params.text,
      maxTokens,
      temperature: 0.1,
      topK: 20,
      topP: 0.9,
    });

    let generatedText = chatResult.text?.trim();
    let fallbackError: string | undefined;
    if (!chatResult.success || !generatedText) {
      const completionResult = await this.service.generateCompletion({
        prompt: [
          systemPrompt,
          "",
          "Text to translate:",
          "<text>",
          params.text,
          "</text>",
          "",
          "Translation:",
        ].join("\n"),
        maxTokens,
        temperature: 0.1,
        topK: 20,
        topP: 0.9,
      });
      generatedText = completionResult.text?.trim();
      fallbackError = completionResult.error;
    }

    const translation = this.cleanTranslation(generatedText || "");
    if (!translation) {
      const details = [
        chatResult.error || (!chatResult.text?.trim() ? "Chat generation returned no text" : ""),
        fallbackError || "Raw completion returned no text",
      ]
        .filter(Boolean)
        .join("; ");
      const error = `This GGUF model could not generate a translation. ${details}`.trim();
      this.setState({ ...this.state, lastGenerationError: error });
      return { success: false, error };
    }

    this.setState({ ...this.state, lastGenerationError: null });
    return {
      success: true,
      data: {
        detectedLang: "unknown",
        needsTranslation: translation !== params.text,
        translation,
      },
    };
  }

  private cleanTranslation(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
      .replace(/^```(?:\w+)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^(?:translation|translated text)\s*:\s*/i, "")
      .trim();
  }

  /*
   * Keep language names human-readable for smaller models, which generally
   * follow "English" more reliably than an isolated ISO code such as "en".
   */
  private languageName(languageCode: string): string {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) || languageCode;
    } catch {
      return languageCode;
    }
  }

  private setState(state: WllamaTranslationState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export const wllamaTranslationService = new BrowserTranslationService();
