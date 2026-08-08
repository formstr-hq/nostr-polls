import type { Wllama as WllamaInstance } from "@wllama/wllama/esm/index.js";

type WllamaModule = typeof import("@wllama/wllama/esm/index.js");

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

interface GenerationResult {
  success: boolean;
  text?: string;
  error?: string;
}

const publicUrl = process.env.PUBLIC_URL || "";
const wasmPath = `${publicUrl}/wllama/wllama.wasm`;
const hasWebGPU = () =>
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  "gpu" in navigator;

class InMemoryStorageBackend {
  private readonly files = new Map<string, Blob>();

  isSupported(): boolean {
    return true;
  }

  read(key: string): Promise<Blob | null> {
    return Promise.resolve(this.files.get(key) ?? null);
  }

  async write(key: string, stream: ReadableStream): Promise<void> {
    this.files.set(key, await new Response(stream).blob());
  }

  getSize(key: string): Promise<number> {
    return Promise.resolve(this.files.get(key)?.size ?? -1);
  }

  list(): Promise<Array<{ key: string; size: number }>> {
    return Promise.resolve(
      Array.from(this.files, ([key, file]) => ({ key, size: file.size })),
    );
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }
}

const createCacheManager = (CacheManager: WllamaModule["CacheManager"]) => {
  try {
    return new CacheManager();
  } catch {
    // Some browser and Capacitor WebView environments do not expose OPFS.
    // Local GGUF files do not need persistent storage, but Wllama still
    // requires a supported cache backend when it is constructed.
    return new CacheManager([new InMemoryStorageBackend()]);
  }
};

/**
 * Owns the single in-browser model instance used by every poll card.
 *
 * GGUF models are intentionally session-scoped: retaining a user-selected
 * multi-hundred-megabyte File in localStorage is not possible, and silently
 * duplicating it in IndexedDB would consume a surprising amount of storage.
 */
class BrowserTranslationService {
  private wllama: WllamaInstance | null = null;

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
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return {
        success: false,
        error: "Local translation can only run in a browser environment.",
      };
    }

    if (typeof WebAssembly === "undefined") {
      return {
        success: false,
        error: "WebAssembly is not supported in this browser.",
      };
    }

    return {
      success: true,
      hasWebGPU: hasWebGPU(),
      crossOriginIsolated: window.crossOriginIsolated,
    };
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

    await this.releaseModel();

    try {
      this.setState({ ...this.state, progress: 10 });
      const { CacheManager, Wllama } = await import("@wllama/wllama/esm/index.js");
      const wllama = new Wllama(
        { default: wasmPath },
        { cacheManager: createCacheManager(CacheManager) },
      );
      this.wllama = wllama;
      this.setState({ ...this.state, progress: 30 });

      const useWebGPU = hasWebGPU();
      await wllama.loadModel([file], {
        n_ctx: 2048,
        // WebGPU does not require cross-origin isolation. COOP/COEP headers
        // are only needed for Wllama's multi-threaded WASM CPU runtime.
        n_gpu_layers: useWebGPU ? 999 : 0,
        jinja: true,
      });

      this.setState({
        status: "ready",
        progress: 100,
        modelName: file.name,
        usedWebGPU: useWebGPU,
        error: null,
        lastGenerationError: null,
      });
      return true;
    } catch (error) {
      await this.releaseModel();
      this.setState({
        status: "error",
        progress: 0,
        modelName: "",
        usedWebGPU: false,
        error: this.errorMessage(error, "Failed to load the model."),
        lastGenerationError: null,
      });
      return false;
    }
  }

  async unload(): Promise<void> {
    await this.releaseModel();
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
    if (!this.wllama?.isModelLoaded()) {
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
    const chatResult = await this.generateChat({
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
      const completionResult = await this.generateCompletion({
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

  private async generateChat(params: {
    system: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
    topK: number;
    topP: number;
  }): Promise<GenerationResult> {
    if (!this.wllama) {
      return { success: false, error: "No model is loaded." };
    }

    try {
      const response = await this.wllama.createChatCompletion({
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.prompt },
        ],
        stream: false,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        top_k: params.topK,
        top_p: params.topP,
      });

      return {
        success: true,
        text: response.choices?.[0]?.message?.content || "",
      };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, "Chat generation failed."),
      };
    }
  }

  private async generateCompletion(params: {
    prompt: string;
    maxTokens: number;
    temperature: number;
    topK: number;
    topP: number;
  }): Promise<GenerationResult> {
    if (!this.wllama) {
      return { success: false, error: "No model is loaded." };
    }

    try {
      const response = await this.wllama.createCompletion({
        prompt: params.prompt,
        stream: false,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        top_k: params.topK,
        top_p: params.topP,
      });

      return {
        success: true,
        text: response.choices?.[0]?.text || "",
      };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, "Raw completion failed."),
      };
    }
  }

  private async releaseModel(): Promise<void> {
    const wllama = this.wllama;
    this.wllama = null;
    if (!wllama) return;

    try {
      await wllama.exit();
    } catch {
      // Cleanup is best effort; the app state must still return to idle.
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
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
