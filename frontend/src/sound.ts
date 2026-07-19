// 체결/알림용 짧은 비프음. 외부 에셋 없이 WebAudio 오실레이터로 생성.
// 설정(soundEnabled)이 켜졌을 때만 호출한다.
let ctx: AudioContext | null = null;

export function beep(kind: "buy" | "sell" | "alert" = "alert"): void {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // 매수 높은음 / 매도 낮은음 / 알림 중간음
    osc.frequency.value = kind === "buy" ? 880 : kind === "sell" ? 480 : 660;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch {
    /* 오디오 미지원/차단 시 무시 */
  }
}
