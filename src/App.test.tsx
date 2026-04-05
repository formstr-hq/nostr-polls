import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./hooks/useMiningWorker", () => ({
  useMiningWorker: () => ({
    minePow: jest.fn(),
    isCompleted: false,
    cancelMining: jest.fn(),
    progress: { maxDifficultyAchieved: 0, numHashes: 0 },
  }),
}));

jest.mock("nostr-signer-capacitor-plugin", () => ({
  NostrSignerPlugin: {
    getInstalledSignerApps: () => Promise.resolve({ apps: [] }),
  },
}));

test("shows Pollerama header", async () => {
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: /pollerama/i }),
  ).toBeInTheDocument();
});
