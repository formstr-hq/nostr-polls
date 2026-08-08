import {
  cleanTranslation,
  createTranslationPrompts,
} from "./wllama-translation-prompt";
import { WllamaRuntime } from "./wllama-runtime";

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

/** Coordinates translation prompts and observable UI state. */
class BrowserTranslationService {
  private readonly runtime = new WllamaRuntime();
  private readonly listeners = new Set<() => void>();
  private generationQueue: Promise<void> = Promise.resolve();

  private state: WllamaTranslationState = {
    status: "idle",
    progress: 0,
    modelName: "",
    usedWebGPU: false,
    error: null,
    lastGenerationError: null,
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): WllamaTranslationState => this.state;

  getEnvironment() {
    return this.runtime.getEnvironment();
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

    try {
      const result = await this.runtime.loadModel(file, (progress) => {
        this.setState({ ...this.state, progress });
      });
      this.setState({
        status: "ready",
        progress: 100,
        modelName: file.name,
        usedWebGPU: result.usedWebGPU,
        error: null,
        lastGenerationError: null,
      });
      return true;
    } catch (error) {
      this.setState({
        status: "error",
        progress: 0,
        modelName: "",
        usedWebGPU: false,
        error: error instanceof Error ? error.message : "Failed to load the model.",
        lastGenerationError: null,
      });
      return false;
    }
  }

  async unload(): Promise<void> {
    await this.runtime.unload();
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
    if (!this.runtime.isLoaded) {
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

    const prompts = createTranslationPrompts(params.text, params.targetLang);
    const generationOptions = {
      maxTokens: prompts.maxTokens,
      temperature: 0.1,
      topK: 20,
      topP: 0.9,
    };
    const chatResult = await this.runtime.generateChat({
      ...generationOptions,
      system: prompts.system,
      prompt: params.text,
    });

    let generatedText = chatResult.text?.trim();
    let fallbackError: string | undefined;
    if (!chatResult.success || !generatedText) {
      const completionResult = await this.runtime.generateCompletion({
        ...generationOptions,
        prompt: prompts.completion,
      });
      generatedText = completionResult.text?.trim();
      fallbackError = completionResult.error;
    }

    const translation = cleanTranslation(generatedText || "");
    if (!translation) {
      const details = [
        chatResult.error ||
          (!chatResult.text?.trim()
            ? "Chat generation returned no text"
            : ""),
        fallbackError || "Raw completion returned no text",
      ]
        .filter(Boolean)
        .join("; ");
      const error =
        `This GGUF model could not generate a translation. ${details}`.trim();
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

  private setState(state: WllamaTranslationState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export const wllamaTranslationService = new BrowserTranslationService();
