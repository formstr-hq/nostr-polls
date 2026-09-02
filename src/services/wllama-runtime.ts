import type { Wllama as WllamaInstance } from "@wllama/wllama/esm/index.js";

type WllamaModule = typeof import("@wllama/wllama/esm/index.js");

export interface WllamaEnvironment {
  success: boolean;
  hasWebGPU?: boolean;
  crossOriginIsolated?: boolean;
  error?: string;
}

export interface WllamaGenerationParams {
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
}

export interface WllamaGenerationResult {
  success: boolean;
  text?: string;
  error?: string;
}

const publicUrl = process.env.PUBLIC_URL || "";
const wasmPath = `${publicUrl}/wllama/wllama.wasm`;
const hasWebGPU = () =>
  typeof navigator !== "undefined" && "gpu" in navigator;

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
    // Local GGUF files do not need persistent storage, but Wllama requires a
    // supported backend even in WebViews that do not expose OPFS.
    return new CacheManager([new InMemoryStorageBackend()]);
  }
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** Owns the browser-side Wllama instance and its model lifecycle. */
export class WllamaRuntime {
  private wllama: WllamaInstance | null = null;

  getEnvironment(): WllamaEnvironment {
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
      crossOriginIsolated: window.crossOriginIsolated === true,
    };
  }

  get isLoaded(): boolean {
    return this.wllama?.isModelLoaded() === true;
  }

  async loadModel(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<{ usedWebGPU: boolean }> {
    await this.unload();

    try {
      onProgress?.(10);
      const { CacheManager, Wllama } = await import(
        "@wllama/wllama/esm/index.js"
      );
      const wllama = new Wllama(
        { default: wasmPath },
        { cacheManager: createCacheManager(CacheManager) },
      );
      this.wllama = wllama;
      onProgress?.(30);

      const usedWebGPU = hasWebGPU();
      await wllama.loadModel([file], {
        n_ctx: 2048,
        // COOP/COEP is only required for multi-threaded WASM, not WebGPU.
        n_gpu_layers: usedWebGPU ? 999 : 0,
        jinja: true,
      });
      onProgress?.(100);
      return { usedWebGPU };
    } catch (error) {
      await this.unload();
      throw new Error(errorMessage(error, "Failed to load the model."));
    }
  }

  async generateChat(
    params: WllamaGenerationParams,
  ): Promise<WllamaGenerationResult> {
    if (!this.wllama) {
      return { success: false, error: "No model is loaded." };
    }

    try {
      const messages: Array<{
        role: "system" | "user";
        content: string;
      }> = [];
      if (params.system) {
        messages.push({ role: "system", content: params.system });
      }
      messages.push({ role: "user", content: params.prompt });

      const response = await this.wllama.createChatCompletion({
        messages,
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
        error: errorMessage(error, "Chat generation failed."),
      };
    }
  }

  async generateCompletion(
    params: WllamaGenerationParams,
  ): Promise<WllamaGenerationResult> {
    if (!this.wllama) {
      return { success: false, error: "No model is loaded." };
    }

    try {
      const response = await this.wllama.createCompletion({
        prompt: params.system
          ? `${params.system}\n\n${params.prompt}`
          : params.prompt,
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
        error: errorMessage(error, "Raw completion failed."),
      };
    }
  }

  async unload(): Promise<void> {
    const wllama = this.wllama;
    this.wllama = null;
    if (!wllama) return;

    try {
      await wllama.exit();
    } catch {
      // Cleanup is best effort; callers still need the runtime reset.
    }
  }
}
