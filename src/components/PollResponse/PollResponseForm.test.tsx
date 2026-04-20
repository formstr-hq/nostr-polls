import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Event } from "nostr-tools";
import PollResponseForm from "./PollResponseForm";

jest.mock("../../nostr", () => ({
  signEvent: jest.fn(),
  openProfileTab: jest.fn(),
}));

jest.mock("../../singletons", () => ({
  pool: { publish: jest.fn() },
}));

jest.mock("../Common/Parsers/TextWithImages", () => ({
  TextWithImages: ({ content }: { content: string }) => <span>{content}</span>,
}));

jest.mock("../Common/Nip05Badge", () => ({
  Nip05Badge: () => null,
}));

jest.mock("../FeedbackMenu", () => ({
  FeedbackMenu: () => null,
}));

jest.mock("../../hooks/usePollResults", () => ({
  usePollResults: () => ({ results: new Map() }),
}));

jest.mock("../../hooks/useEventRelays", () => ({
  useEventRelays: () => [],
}));

jest.mock("../../hooks/useReports", () => ({
  useReports: () => ({
    reportEvent: jest.fn(),
    reportUser: jest.fn(),
    isReportedByMe: () => false,
    getWoTReporters: () => new Set<string>(),
    wotReportThreshold: 0,
    requestUserReportCheck: jest.fn(),
  }),
}));

jest.mock("../../hooks/usePublishDiagnostic", () => ({
  usePublishDiagnostic: () => ({
    result: null,
    open: false,
    setOpen: jest.fn(),
    title: "",
    openModal: jest.fn(),
    retry: jest.fn(),
  }),
}));

jest.mock("../../hooks/useMiningWorker", () => ({
  useMiningWorker: () => ({
    minePow: jest.fn(),
    cancelMining: jest.fn(),
    progress: { maxDifficultyAchieved: 0, numHashes: 0 },
  }),
}));

jest.mock("../../hooks/useBackClose", () => ({
  useBackClose: jest.fn(),
}));

jest.mock("../../hooks/useRelays", () => ({
  useRelays: () => ({ relays: [], writeRelays: [] }),
}));

jest.mock("../../hooks/useListContext", () => ({
  useListContext: () => ({ fetchLatestContactList: jest.fn() }),
}));

jest.mock("../../hooks/useUserContext", () => ({
  useUserContext: () => ({
    user: null,
    setUser: jest.fn(),
    requestLogin: jest.fn(),
  }),
}));

jest.mock("../../hooks/useAppContext", () => ({
  useAppContext: () => ({
    profiles: new Map(),
    fetchUserProfileThrottled: jest.fn(),
  }),
}));

jest.mock("../../contexts/notification-context", () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

const theme = createTheme();

function renderPoll(pollEvent: Event) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PollResponseForm pollEvent={pollEvent} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("PollResponseForm", () => {
  it("renders poll title (content) and all option labels", () => {
    const pollEvent: Event = {
      kind: 1068,
      id: "bb".repeat(32),
      pubkey: "aa".repeat(32),
      content: "Which runtime do you prefer?",
      tags: [
        ["option", "opt-node", "Node.js"],
        ["option", "opt-bun", "Bun"],
        ["option", "opt-deno", "Deno"],
        ["polltype", "singlechoice"],
      ],
      sig: "cc".repeat(64),
      created_at: 1_700_000_000,
    };

    renderPoll(pollEvent);

    expect(
      screen.getByText("Which runtime do you prefer?")
    ).toBeInTheDocument();
    expect(screen.getByText("Node.js")).toBeInTheDocument();
    expect(screen.getByText("Bun")).toBeInTheDocument();
    expect(screen.getByText("Deno")).toBeInTheDocument();
  });

  it("uses label tag over content when present", () => {
    const pollEvent: Event = {
      kind: 1068,
      id: "dd".repeat(32),
      pubkey: "ee".repeat(32),
      content: "ignored body",
      tags: [
        ["label", "Shown title from label tag"],
        ["option", "x", "Only option"],
        ["polltype", "singlechoice"],
      ],
      sig: "ff".repeat(64),
      created_at: 1,
    };

    renderPoll(pollEvent);

    expect(
      screen.getByText("Shown title from label tag")
    ).toBeInTheDocument();
    expect(screen.queryByText("ignored body")).not.toBeInTheDocument();
    expect(screen.getByText("Only option")).toBeInTheDocument();
  });
});
