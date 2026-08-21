import type { RtcHelper } from '../../shared/rtc';
import { AppRtmSession, type AppRtmClient } from './app-rtm';
import type { VoiceRoomSceneProps } from './VoiceRoomScene';

export interface VoiceRoomFakes {
  overrides: NonNullable<VoiceRoomSceneProps['overrides']>;
}

function createRtc(): RtcHelper {
  const noop = async () => undefined;
  return {
    registerEvents: () => undefined,
    join: noop,
    leave: noop,
    publishMicrophone: noop,
    unpublishMicrophone: noop,
    setMicrophoneMuted: noop,
    isMicrophoneCaptureHealthy: () => true,
    publishCamera: noop,
    unpublishCamera: noop,
    setCameraMuted: noop,
    getLocalVideoTrack: () => undefined,
  };
}

function createAppRtmSession(appId: string, userId: string): AppRtmSession {
  return new AppRtmSession(appId, userId, {
    createClient: () => ({
      addEventListener() {},
      removeEventListener() {},
      async login() {},
      async logout() {},
      async subscribe() {},
      async unsubscribe() {},
      async publish() {},
      presence: {
        async setState() {},
        async removeState() {},
      },
      storage: { async setChannelMetadata() {} },
    } as AppRtmClient),
  });
}

/** Network-free fakes for the current single-role voice-room page. */
export function createVoiceRoomFakes(): VoiceRoomFakes {
  return {
    overrides: {
      createAppRtmSession,
      createRtc,
      storage: window.localStorage,
    },
  };
}
