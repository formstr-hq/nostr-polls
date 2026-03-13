export const NOTIFICATION_MESSAGES = {
  // Clipboard operations
  POLL_URL_COPIED: "Poll URL copied to clipboard!",
  EVENT_COPIED: "Event copied to clipboard!",
  NEVENT_COPIED: "Event ID copied to clipboard!",
  NPUB_COPIED: "Author npub copied to clipboard!",
  POLL_URL_COPY_FAILED: "Failed to copy poll URL.",
  EVENT_COPY_FAILED: "Failed to copy event.",
  COPY_FAILED: "Failed to copy to clipboard.",
  RAW_EVENT_COPIED: "Raw event copied to clipboard!",

  // Authentication
  ANONYMOUS_LOGIN: "Login not found, submitting anonymously",
  NIP07_INIT_FAILED: "Failed to initialize NIP-07 signer",
  NIP46_INIT_FAILED: "Failed to initialize NIP-46 signer",

  // Validation errors
  INVALID_URL: "Invalid URL",
  INVALID_AMOUNT: "Invalid amount.",
  PAST_DATE_ERROR: "You cannot select a past date/time.",
  RECIPIENT_PROFILE_ERROR: "Could not fetch recipient profile",
  EMPTY_POLL_OPTIONS: "Poll options cannot be empty.",
  MIN_POLL_OPTIONS: "A poll must have at least one option.",

  // Poll operations
  POLL_NOT_FOUND: "Could not find the given poll",
  POLL_FETCH_ERROR: "Error fetching poll event.",

  // User actions
  LOGIN_TO_LIKE: "Login To Like!",
  LOGIN_TO_COMMENT: "Login To Comment",
  LOGIN_TO_ZAP: "Log In to send zaps!",
  LOGIN_TO_REPOST: "Login to repost!",

  // Event creation
  EMPTY_NOTE_CONTENT: "Note content cannot be empty.",
  NOTE_SIGN_FAILED: "Failed to sign the note.",
  NOTE_PUBLISHED_SUCCESS: "Note published successfully!",
  NOTE_PUBLISH_FAILED: "Failed to publish note. Please try again.",
  EMPTY_POLL_QUESTION: "Poll question cannot be empty.",
  POLL_SIGN_FAILED: "Failed to sign the poll.",
  POLL_PUBLISHED_SUCCESS: "Poll published successfully!",
  POLL_PUBLISH_FAILED: "Failed to publish poll. Please try again.",
  NOTE_PUBLISH_NO_RELAY:
    "None of the relays accepted your note within 5 seconds.",
  POLL_PUBLISH_NO_RELAY:
    "None of the relays accepted your poll within 5 seconds.",
} as const;

export type NotificationMessageKey = keyof typeof NOTIFICATION_MESSAGES;
