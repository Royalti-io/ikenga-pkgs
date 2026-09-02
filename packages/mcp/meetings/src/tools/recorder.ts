import { MeetingsDbClient, MeetingStatus } from '@ikenga/meetings-contract';
import crypto from 'node:crypto';

export const RECORDER_TOOLS = [
  {
    name: 'list_meetings',
    description: 'List recorded and scheduled meetings from local SQLite database.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['scheduled', 'joining', 'recording', 'transcribing', 'completed', 'failed'],
          description: 'Filter by meeting status.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of meetings to return (default 20).',
        },
      },
    },
  },
  {
    name: 'start_recording',
    description:
      'Start a local meeting recording session (screen and microphone/system audio) with 100% on-device processing.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the meeting or recording session.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'start_local_recorder',
    description:
      'Start a local own-machine meeting recording session (screen and microphone/system audio) with 100% on-device processing.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the meeting or recording session.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'stop_recording',
    description: 'Stop the active meeting recording session and trigger audio extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_id: {
          type: 'string',
          description: 'UUID of the meeting session to stop.',
        },
      },
      required: ['meeting_id'],
    },
  },
  {
    name: 'stop_local_recorder',
    description: 'Stop the active meeting recording session and trigger audio extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_id: {
          type: 'string',
          description: 'UUID of the meeting session to stop.',
        },
      },
      required: ['meeting_id'],
    },
  },
  {
    name: 'schedule_recording',
    description:
      'Register a scheduled meeting recording slot with a specified title and planned start time.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title for the scheduled call.',
        },
        start_time: {
          type: 'string',
          description: 'ISO-8601 datetime string for scheduled start time.',
        },
        platform: {
          type: 'string',
          enum: ['local_recording', 'google_meet', 'zoom', 'microsoft_teams', 'other'],
          default: 'local_recording',
        },
        url: {
          type: 'string',
          description: 'Optional meeting URL.',
        },
      },
      required: ['title', 'start_time'],
    },
  },
];

export async function handleRecorderTool(
  client: MeetingsDbClient,
  name: string,
  args: any
): Promise<any> {
  switch (name) {
    case 'list_meetings': {
      const meetings = await client.listMeetings({
        status: args?.status ? (args.status as MeetingStatus) : undefined,
        limit: args?.limit ? Number(args.limit) : 20,
      });
      return {
        count: meetings.length,
        meetings: meetings.map((m) => ({
          id: m.id,
          title: m.title,
          platform: m.platform,
          status: m.status,
          start_time: m.start_time,
          duration_seconds: m.duration_seconds,
        })),
      };
    }

    case 'start_recording':
    case 'start_local_recorder': {
      const meetingId = crypto.randomUUID();
      const now = new Date().toISOString();
      const newMeeting = {
        id: meetingId,
        title: String(args?.title ?? 'Untitled Recording'),
        platform: 'local_recording' as const,
        status: 'recording' as const,
        start_time: now,
        duration_seconds: 0,
        created_at: now,
        updated_at: now,
      };
      await client.insertMeeting(newMeeting);
      return {
        ok: true,
        meeting_id: meetingId,
        title: newMeeting.title,
        status: 'recording',
        message: 'Started local meeting recording.',
      };
    }

    case 'stop_recording':
    case 'stop_local_recorder': {
      const meetingId = String(args?.meeting_id ?? '');
      await client.updateMeetingStatus(meetingId, 'completed', {
        end_time: new Date().toISOString(),
      });
      return {
        ok: true,
        meeting_id: meetingId,
        status: 'completed',
        message: 'Recording stopped.',
      };
    }

    case 'schedule_recording': {
      const meetingId = crypto.randomUUID();
      const now = new Date().toISOString();
      const scheduled = {
        id: meetingId,
        title: String(args?.title ?? 'Scheduled Meeting'),
        platform: (args?.platform ?? 'local_recording') as any,
        url: typeof args?.url === 'string' && args.url.trim() ? args.url.trim() : undefined,
        status: 'scheduled' as const,
        start_time: String(args?.start_time ?? now),
        duration_seconds: 0,
        created_at: now,
        updated_at: now,
      };
      await client.insertMeeting(scheduled);
      return {
        ok: true,
        meeting_id: meetingId,
        title: scheduled.title,
        status: 'scheduled',
        start_time: scheduled.start_time,
      };
    }

    default:
      throw new Error(`Unknown recorder tool: ${name}`);
  }
}
