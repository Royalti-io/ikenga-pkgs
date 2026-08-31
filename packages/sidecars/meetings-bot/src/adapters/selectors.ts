/**
 * Centralized DOM selectors for Meeting platforms.
 * 
 * CRITICAL RULE (D4 / D9 / WP-04):
 * ALL selectors must use aria-label, accessibility roles, or button text.
 * NEVER use obfuscated classnames (e.g. '.U26fgb', '.VfPpkd-*').
 */

export const GOOGLE_MEET_SELECTORS = {
  // Pre-join entry screen
  NAME_INPUT: 'input[aria-label*="name" i], input[placeholder*="name" i]',
  ASK_TO_JOIN_BUTTON: 'button:has-text("Ask to join"), button:has-text("Join now")',
  JOIN_NOW_BUTTON: 'button:has-text("Join now")',
  MUTE_MIC_BUTTON: 'button[aria-label*="turn off microphone" i], button[aria-label*="mute microphone" i]',
  MUTE_CAM_BUTTON: 'button[aria-label*="turn off camera" i], button[aria-label*="turn off video" i]',

  // In-call UI
  LEAVE_CALL_BUTTON: 'button[aria-label*="Leave call" i], button[aria-label*="End call" i]',
  CHAT_BUTTON: 'button[aria-label*="Chat with everyone" i], button[aria-label*="chat" i]',
  CHAT_INPUT: 'textarea[aria-label*="Send a message" i], textarea[aria-label*="Chat" i]',
  CHAT_SEND_BUTTON: 'button[aria-label*="Send message" i], button[aria-label*="Send" i]',
  CHAT_MESSAGES: '[role="listitem"] [role="document"], [aria-label*="message" i]',

  // Speaker & Roster
  ACTIVE_SPEAKER_CONTAINER: '[aria-label*="speaking" i], [aria-label*="is talking" i]',
  PARTICIPANT_TILES: '[data-participant-id], [role="listitem"][aria-label]',
  ROSTER_NAMES: '[aria-label*="participant" i] span, [data-self-name]',
} as const;
