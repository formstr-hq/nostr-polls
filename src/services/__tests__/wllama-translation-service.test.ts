const mockGenerate = jest.fn();
const mockGenerateCompletion = jest.fn();
const mockLoadModel = jest.fn();
const mockUnload = jest.fn();
let mockLoaded = false;
let mockCurrentModel = "";

jest.mock("wllama-service", () => ({
  WllamaService: jest.fn().mockImplementation(() => ({
    checkEnvironment: () => ({
      success: true,
      hasWebGPU: false,
      crossOriginIsolated: false,
    }),
    loadModel: (...args: unknown[]) => mockLoadModel(...args),
    generate: (...args: unknown[]) => mockGenerate(...args),
    generateCompletion: (...args: unknown[]) => mockGenerateCompletion(...args),
    unload: (...args: unknown[]) => mockUnload(...args),
    get isLoaded() {
      return mockLoaded;
    },
    get currentModel() {
      return mockCurrentModel;
    },
  })),
}));

import { wllamaTranslationService } from "../wllama-translation-service";

describe("wllamaTranslationService", () => {
  beforeEach(async () => {
    mockLoaded = false;
    mockCurrentModel = "";
    mockGenerate.mockReset();
    mockGenerateCompletion.mockReset();
    mockLoadModel.mockReset();
    mockUnload.mockReset();
    mockUnload.mockImplementation(async () => {
      mockLoaded = false;
      mockCurrentModel = "";
    });
    await wllamaTranslationService.unload();
  });

  it("rejects files that are not GGUF models", async () => {
    const loaded = await wllamaTranslationService.loadModel(
      new File(["not a model"], "notes.txt", { type: "text/plain" }),
    );

    expect(loaded).toBe(false);
    expect(mockLoadModel).not.toHaveBeenCalled();
    expect(wllamaTranslationService.getSnapshot()).toMatchObject({
      status: "error",
      error: "Choose a GGUF model file.",
    });
  });

  it("loads one model and translates locally", async () => {
    mockLoadModel.mockImplementation(
      async (file: File, onProgress?: (progress: number) => void) => {
        onProgress?.(50);
        mockLoaded = true;
        mockCurrentModel = file.name;
        return { success: true, usedWebGPU: false };
      },
    );
    mockGenerate.mockResolvedValue({ success: true, text: "Hello", timeMs: 25 });

    const loaded = await wllamaTranslationService.loadModel(
      new File(["model"], "translator.gguf"),
    );
    const result = await wllamaTranslationService.translateText({
      text: "Hola",
      targetLang: "en",
    });

    expect(loaded).toBe(true);
    expect(wllamaTranslationService.getSnapshot()).toMatchObject({
      status: "ready",
      progress: 100,
      modelName: "translator.gguf",
    });
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hola", temperature: 0.1 }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        detectedLang: "unknown",
        needsTranslation: true,
        translation: "Hello",
      },
    });
  });

  it("falls back to a raw completion when the GGUF chat template fails", async () => {
    mockLoadModel.mockImplementation(async (file: File) => {
      mockLoaded = true;
      mockCurrentModel = file.name;
      return { success: true, usedWebGPU: false };
    });
    mockGenerate.mockResolvedValue({
      success: false,
      error: "The model does not contain a chat template",
    });
    mockGenerateCompletion.mockResolvedValue({
      success: true,
      text: "Translation: Hello",
      timeMs: 30,
    });

    await wllamaTranslationService.loadModel(
      new File(["model"], "base-model.gguf"),
    );
    const result = await wllamaTranslationService.translateText({
      text: "Hola",
      targetLang: "en",
    });

    expect(mockGenerateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Translation:"),
        temperature: 0.1,
      }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        detectedLang: "unknown",
        needsTranslation: true,
        translation: "Hello",
      },
    });
    expect(
      wllamaTranslationService.getSnapshot().lastGenerationError,
    ).toBeNull();
  });
});
