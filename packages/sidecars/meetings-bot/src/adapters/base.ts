import { EventEmitter } from 'node:events';

export interface JoinMeetingOptions {
  url: string;
  botName: string;
  passcode?: string;
  disclosureMessage?: string;
}

export interface SpeakerTransitionEvent {
  speakerName: string;
  timestampMs: number;
}

export interface ParticipantObjectionEvent {
  participantName?: string;
  message: string;
  timestampMs: number;
}

export interface MeetingAdapter extends EventEmitter {
  join(options: JoinMeetingOptions): Promise<void>;
  leave(): Promise<void>;
  muteAudioAndVideo(): Promise<void>;
  sendChatMessage(message: string): Promise<void>;
  isInCall(): boolean;
}
