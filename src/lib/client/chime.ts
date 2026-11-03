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

export type Earcon = "connect" | "card" | "success" | "end";

// Notes (Hz, start offset in s) for each interface sound: short, soft, and musical so they feel
// premium rather than "beepy". "success" is a rising major arpeggio for a placed order.
const EARCONS: Record<Earcon, Array<[number, number]>> = {
  connect: [
    [659.25, 0],
    [987.77, 0.09],
  ],
  card: [[1318.5, 0]],
  success: [
    [783.99, 0],
    [987.77, 0.1],
    [1174.66, 0.2],
    [1567.98, 0.32],
  ],
  end: [
    [880, 0],
    [587.33, 0.1],
  ],
};

/** Plays a short interface sound. Silently does nothing until the page may play audio. */
export async function playEarcon(kind: Earcon, volume = 0.1): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 150))]);
  }
  if (ctx.state !== "running") return;
  const start = ctx.currentTime + 0.01;
  const length = kind === "card" ? 0.18 : 0.38;
  for (const [frequency, offset] of EARCONS[kind]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = kind === "card" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + offset);
    gain.gain.linearRampToValueAtTime(volume, start + offset + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + length + 0.05);
  }
}
