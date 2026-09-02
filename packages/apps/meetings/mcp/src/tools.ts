import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TRANSCRIBE_TOOL: Tool = {
  name: 'transcribe',
  description:
    'Transcribe meeting audio using local whisper.cpp on a supervised long-lived process. Guaranteed clean child termination on shutdown/reload.',
  inputSchema: {
    type: 'object',
    properties: {
      meeting_id: {
        type: 'string',
        description: 'Unique meeting ID to transcribe.',
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

export const TOOLS: Tool[] = [
  TRANSCRIBE_TOOL,
  TRANSCRIBE_STATUS_TOOL,
  TRANSCRIBE_CANCEL_TOOL,
];
