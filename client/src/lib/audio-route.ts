/**
 * Earpiece / loudspeaker switching for calls, like WhatsApp and Instagram.
 *
 * Android Chrome (and the TWA) exposes the phone's audio routes as microphones named
 * "Speakerphone", "Headset earpiece", "Wired headset", "Bluetooth headset"; opening the call
 * microphone on one of them moves the call sound there too. Browsers with `setSinkId` and a
 * named earpiece output switch the remote audio element instead. Elsewhere there is no route
 * to choose, and the caller hides the button.
 */
export type AudioRoutes = { mode: "input" | "output"; earpiece: string; speaker: string };

export const CALL_AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };

const canSetSink = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/** Needs microphone permission first: device labels are empty until it is granted. */
export async function findAudioRoutes(): Promise<AudioRoutes | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
    // A connected headset is the private route; otherwise the phone's earpiece.
    const privateInput =
      inputs.find((d) => /bluetooth|wired headset|usb/i.test(d.label)) ?? inputs.find((d) => /earpiece/i.test(d.label));
    const speakerInput = inputs.find((d) => /speakerphone/i.test(d.label));
    if (privateInput && speakerInput)
      return { mode: "input", earpiece: privateInput.deviceId, speaker: speakerInput.deviceId };
    if (canSetSink()) {
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      const earpiece = outputs.find((d) => /earpiece|receiver|handset/i.test(d.label));
      const speaker =
        outputs.find((d) => d !== earpiece && /speaker/i.test(d.label)) ?? outputs.find((d) => d.deviceId === "default");
      if (earpiece && speaker) return { mode: "output", earpiece: earpiece.deviceId, speaker: speaker.deviceId };
    }
  } catch {
    /* device list unavailable */
  }
  return null;
}

/** Opens the call microphone on a route; on Android this also moves the call sound. */
export async function routedMicrophone(deviceId: string) {
  const media = await navigator.mediaDevices.getUserMedia({ audio: { ...CALL_AUDIO, deviceId: { exact: deviceId } } });
  return media.getAudioTracks()[0];
}
