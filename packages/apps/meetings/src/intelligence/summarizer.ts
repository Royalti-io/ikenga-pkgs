import { TranscriptSegment, MeetingSummary, MeetingActionItem } from '@ikenga/meetings-contract';
// NOTE: `crypto.randomUUID()` is the WEB Crypto global, deliberately NOT
// `node:crypto`. This module is imported by the iframe app, and a `node:crypto`
// import makes the whole package unbundleable for the browser (rollup: "node:crypto
// is not exported"), the same failure the media-fs barrel caused. `randomUUID` is
// on the global `crypto` in every browser this ships to and in Node >= 19, so the
// node-side tests keep working unchanged.

export interface MeetingAnalysisResult {
  summary: MeetingSummary;
  actionItems: MeetingActionItem[];
}

/**
 * Extracts key decisions, topics, executive summary, and action items from transcripts.
 */
export function summarizeMeetingTranscript(
  meetingId: string,
  segments: TranscriptSegment[]
): MeetingAnalysisResult {
  if (segments.length === 0) {
    return {
      summary: {
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        executive_summary: 'No spoken transcript recorded during this session.',
        key_decisions: [],
        topics_json: [],
        created_at: new Date().toISOString(),
      },
      actionItems: [],
    };
  }

  const fullText = segments.map((s) => `${s.speaker_name ?? 'Speaker'}: ${s.text}`).join('\n');

  // Rule-based heuristic extraction for key decisions & commitments
  const keyDecisions: string[] = [];
  const actionItems: MeetingActionItem[] = [];
  const topics: Set<string> = new Set();

  for (const seg of segments) {
    const text = seg.text;
    const lower = text.toLowerCase();

    // Decisions
    if (lower.includes('agreed on') || lower.includes('decided to') || lower.includes('locked in') || lower.includes('confirmed that')) {
      keyDecisions.push(text);
    }

    // Action items
    if (
      lower.includes('will send') ||
      lower.includes('action item') ||
      lower.includes('follow up') ||
      lower.includes('draft the') ||
      lower.includes('need to') ||
      lower.includes('to do')
    ) {
      actionItems.push({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        title: text.replace(/^(I will|We will|Please|Let's)\s+/i, '').trim(),
        assignee: seg.speaker_name ?? 'Team Member',
        status: 'pending',
      });
    }

    // Topics
    if (lower.includes('split') || lower.includes('publishing') || lower.includes('royalties')) {
      topics.add('Publishing & Splits');
    }
    if (lower.includes('contract') || lower.includes('legal') || lower.includes('agreement')) {
      topics.add('Legal & Agreements');
    }
    if (lower.includes('master') || lower.includes('delivery') || lower.includes('audio') || lower.includes('mix')) {
      topics.add('Audio & Deliverables');
    }
  }

  const executive_summary = `Meeting covered ${segments.length} spoken segments. Key discussion centered around ${
    Array.from(topics).join(', ') || 'general project review'
  }.`;

  return {
    summary: {
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      executive_summary,
      key_decisions: keyDecisions.length > 0 ? keyDecisions : ['Session recorded and transcribed.'],
      topics_json: Array.from(topics),
      created_at: new Date().toISOString(),
    },
    actionItems,
  };
}
