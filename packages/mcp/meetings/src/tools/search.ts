import { MeetingsDbClient } from '@ikenga/meetings-contract';

export const SEARCH_TOOLS = [
  {
    name: 'search_transcripts',
    description:
      'Search across meeting transcripts for spoken keywords, split negotiations, artist deals, or dates. Returns matching transcript chunks with timestamps and speaker names.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword or phrase to match in transcripts.',
        },
        meeting_id: {
          type: 'string',
          description: 'Optional meeting UUID to scope the search to a single call.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_meeting_transcript',
    description:
      'Retrieve the full timestamped transcript segments and speaker attributions for a given meeting ID.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_id: {
          type: 'string',
          description: 'UUID of the meeting to fetch transcript for.',
        },
      },
      required: ['meeting_id'],
    },
  },
  {
    name: 'get_meeting_summary',
    description:
      'Retrieve the executive summary, key decisions, and extracted topics for a given meeting ID.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_id: {
          type: 'string',
          description: 'UUID of the meeting to fetch summary for.',
        },
      },
      required: ['meeting_id'],
    },
  },
];

export async function handleSearchTool(
  client: MeetingsDbClient,
  name: string,
  args: any
): Promise<any> {
  switch (name) {
    case 'search_transcripts': {
      const query = String(args?.query ?? '');
      const meetingId =
        typeof args?.meeting_id === 'string' && args.meeting_id.trim()
          ? args.meeting_id.trim()
          : undefined;
      const results = await client.searchTranscripts(query, meetingId);
      return {
        query,
        count: results.length,
        segments: results.map((r) => ({
          meeting_id: r.meeting_id,
          speaker: r.speaker_name ?? 'Unknown',
          start_ms: r.start_ms,
          end_ms: r.end_ms,
          text: r.text,
          confidence: r.confidence,
        })),
      };
    }

    case 'get_meeting_transcript': {
      const meetingId = String(args?.meeting_id ?? '');
      const segments = await client.listTranscriptSegments(meetingId);
      const speakers = await client.listSpeakers(meetingId);
      return {
        meeting_id: meetingId,
        speakers: speakers.map((s) => ({
          id: s.id,
          name: s.name,
          source: s.speaker_source,
        })),
        segment_count: segments.length,
        segments: segments.map((s) => ({
          speaker: s.speaker_name ?? 'Speaker',
          start_ms: s.start_ms,
          end_ms: s.end_ms,
          text: s.text,
        })),
      };
    }

    case 'get_meeting_summary': {
      const meetingId = String(args?.meeting_id ?? '');
      const summary = await client.getSummary(meetingId);
      if (!summary) {
        return {
          found: false,
          meeting_id: meetingId,
          message: 'No summary generated yet for this meeting.',
        };
      }
      return {
        found: true,
        meeting_id: summary.meeting_id,
        executive_summary: summary.executive_summary,
        key_decisions: summary.key_decisions,
        topics: summary.topics_json,
      };
    }

    default:
      throw new Error(`Unknown search tool: ${name}`);
  }
}
