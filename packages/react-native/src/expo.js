/**
 * Creates a bridge backed by Expo's native audio and haptic modules. The modules
 * are loaded only when this helper is called, so the base package remains usable
 * in bare React Native applications.
 * @param {{ playerOptions?: Record<string, unknown>, haptics?: boolean }} [options]
 */
export async function createExpoFeedbackBridge(options = {}) {
  let audio;
  try {
    audio = await import("expo-audio");
  } catch {
    throw new Error("Expo feedback requires expo-audio. Install it with: npx expo install expo-audio");
  }

  let haptics = null;
  if (options.haptics !== false) {
    try {
      haptics = await import("expo-haptics");
    } catch {
      haptics = null;
    }
  }

  return {
    async play(asset, playbackOptions) {
      const player = audio.createAudioPlayer(asset, { downloadFirst: true, ...(options.playerOptions ?? {}) });
      player.volume = playbackOptions.volume;
      let subscription;
      let timeout;
      let settled = false;
      let resolveFinished;
      let rejectFinished;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        subscription?.remove?.();
        player.remove();
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) rejectFinished(error);
        else resolveFinished();
      };
      const finished = new Promise((resolve, reject) => {
        resolveFinished = resolve;
        rejectFinished = reject;
      });

      try {
        subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.error) finish(new Error(status.error));
          else if (status.didJustFinish) finish();
        });
        // The measured manifest duration is a bounded fallback for platforms that
        // do not emit a terminal status after audio-device interruption.
        timeout = setTimeout(() => finish(), Math.max(250, playbackOptions.durationMs + 1_000));
        void Promise.resolve(player.seekTo(0)).catch(() => {});
        player.play();
      } catch (error) {
        finish(error);
      }

      return {
        finished,
        stop: () => finish()
      };
    },
    async trigger(intent) {
      if (!haptics) return;
      if (intent === "selection") return haptics.selectionAsync();
      const type = intent === "success"
        ? haptics.NotificationFeedbackType.Success
        : intent === "warning"
          ? haptics.NotificationFeedbackType.Warning
          : haptics.NotificationFeedbackType.Error;
      return haptics.notificationAsync(type);
    }
  };
}
