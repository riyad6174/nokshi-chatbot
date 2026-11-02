// A short two-note "ti-ding" made with WebAudio, so the welcome bubble gets noticed without
// shipping a sound file. Browsers only allow audio after the visitor has interacted with the page:
// playChime resolves false when it isn't allowed yet, so the caller can retry on the first click.

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

export async function playChime(volume = 0.16): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    // resume() can stay pending until a user gesture: don't wait on it forever.
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 150))]);
  }
  if (ctx.state !== "running") return false;

  const start = ctx.currentTime + 0.02;
  for (const [frequency, offset] of [
    [1046.5, 0],
    [1568, 0.11],
  ] as const) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + offset);
    gain.gain.linearRampToValueAtTime(volume, start + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.45);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.5);
  }
  return true;
}
