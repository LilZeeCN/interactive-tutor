// Token budget constants for AI API calls
// Default assumes Claude-class models (200K context).
// Non-Claude models (e.g., glm-5-turbo at 128K) will be capped by the per-request
// truncation logic in ai.ts — these constants serve as an upper bound.
// TODO: Read model context window from settings and adjust budgets dynamically.

const DEFAULT_MODEL_CONTEXT = 200_000;
const SAFETY_MARGIN_RATIO = 0.10;
export const DEFAULT_USABLE_CONTEXT = DEFAULT_MODEL_CONTEXT - Math.floor(DEFAULT_MODEL_CONTEXT * SAFETY_MARGIN_RATIO); // 180,000
export const USABLE_CONTEXT = DEFAULT_USABLE_CONTEXT;

// Chat endpoint
export const CHAT_RESPONSE_RESERVE = 4_096;
export const CHAT_SYSTEM_PROMPT_CAP = 4_000;
export const CHAT_HISTORY_BUDGET = USABLE_CONTEXT - CHAT_RESPONSE_RESERVE - CHAT_SYSTEM_PROMPT_CAP; // ~171,504
export const CHAT_PER_MESSAGE_CAP = 8_000;
export const CHAT_MIN_HISTORY = 10_000;

// AI Modify endpoint
export const MODIFY_RESPONSE_RESERVE = 8_192;
export const MODIFY_MAX_TOTAL_FILE_TOKENS = 120_000;
export const MODIFY_PER_FILE_TOKEN_CAP = 20_000;

// Topic Notes endpoint
export const NOTES_RESPONSE_RESERVE = 8_192;
export const NOTES_HISTORY_TOKEN_CAP = 10_000;
export const NOTES_PER_MSG_CHARS = 800; // legacy char cap, kept for reference
export const NOTES_PER_MSG_TOKEN_CAP = 500; // per-message token cap for topic notes history

// Code Review endpoint
export const REVIEW_RESPONSE_RESERVE = 4_096;
export const REVIEW_CODE_TOKEN_CAP = 100_000;

// Summarization
export const SUMMARY_MAX_DROPPED_MESSAGES = 30;
export const SUMMARY_PER_MESSAGE_CHARS = 600;
export const SUMMARY_OUTPUT_TOKENS = 300;
