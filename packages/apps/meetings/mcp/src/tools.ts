import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TRANSCRIBE_TOOL: Tool = {
  name: 'transcribe',
  description:
    'Transcribe meeting audio via a pluggable backend (WP-19): local whisper.cpp on a supervised long-lived process (default), or the OpenAI Whisper API when a key is configured. Guaranteed clean child termination on shutdown/reload for the local path.',
  inputSchema: {
    type: 'object',
    properties: {
      meeting_id: {
        type: 'string',
        description: 'Unique meeting ID to transcribe.',
      },
      provider: {
        type: 'string',
        enum: ['local', 'openai', 'engine'],
        description:
          "Which STT backend to use. 'local' (default) runs whisper.cpp on this machine. 'openai' calls the OpenAI Whisper API using the key from stt_set_openai_key or OPENAI_API_KEY. 'engine' is not reachable from this server — it requires routing through the shell's active agent session from the iframe, which no shipped engine supports yet — and always fails with a clear error if selected.",
      },
      audio_path: {
        type: 'string',
        description:
          'Optional explicit path to the audio WAV master. If omitted, resolved from the meeting media directory.',
      },
      output_dir: {
        type: 'string',
        description: 'Optional custom media storage root directory.',
      },
      model: {
        type: 'string',
        enum: ['tiny.en', 'base.en', 'small.en', 'medium.en', 'large-v3-q5_0'],
        description:
          'Whisper model name (tiny.en, base.en, small.en, medium.en, large-v3-q5_0). Defaults to small.en.',
      },
      language: {
        type: 'string',
        description: 'Language code for transcription (e.g. en). Defaults to en.',
      },
      whisper_bin: {
        type: 'string',
        description: 'Optional explicit path to the whisper-cli binary.',
      },
      model_dir: {
        type: 'string',
        description: 'Optional explicit directory containing whisper model weights.',
      },
      force: {
        type: 'boolean',
        description:
          'Force re-transcription even if an existing transcript is up-to-date or another run is in flight.',
      },
    },
    required: ['meeting_id'],
  },
};

export const TRANSCRIBE_STATUS_TOOL: Tool = {
  name: 'transcribe_status',
  description: 'Check whether a transcription is currently in flight for a meeting.',
  inputSchema: {
    type: 'object',
    properties: {
      meeting_id: {
        type: 'string',
        description: 'Meeting ID to check.',
      },
    },
    required: ['meeting_id'],
  },
};

export const TRANSCRIBE_CANCEL_TOOL: Tool = {
  name: 'transcribe_cancel',
  description: 'Abort an active transcription and terminate the underlying whisper process immediately.',
  inputSchema: {
    type: 'object',
    properties: {
      meeting_id: {
        type: 'string',
        description: 'Meeting ID whose transcription should be cancelled.',
      },
    },
    required: ['meeting_id'],
  },
};

export const STT_STATUS_TOOL: Tool = {
  name: 'stt_status',
  description:
    'Report real readiness for each STT backend: whether whisper-cli and a model are present locally, and whether an OpenAI key is configured. Never returns the key itself.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const STT_SET_OPENAI_KEY_TOOL: Tool = {
  name: 'stt_set_openai_key',
  description:
    "Store the user's OpenAI API key for the 'openai' transcription backend (WP-19). See mcp/src/secrets-store.ts for exactly where this is persisted and the known gap in routing it through the shell's vault instead.",
  inputSchema: {
    type: 'object',
    properties: {
      api_key: {
        type: 'string',
        description: 'OpenAI API key (e.g. sk-...). Never echoed back or logged.',
      },
    },
    required: ['api_key'],
  },
};

export const STT_CLEAR_OPENAI_KEY_TOOL: Tool = {
  name: 'stt_clear_openai_key',
  description: "Remove the stored OpenAI API key for the 'openai' transcription backend.",
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const TOOLS: Tool[] = [
  TRANSCRIBE_TOOL,
  TRANSCRIBE_STATUS_TOOL,
  TRANSCRIBE_CANCEL_TOOL,
  STT_STATUS_TOOL,
  STT_SET_OPENAI_KEY_TOOL,
  STT_CLEAR_OPENAI_KEY_TOOL,
];
