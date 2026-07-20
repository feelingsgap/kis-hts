// 체결/알림 음성 안내. 백엔드 macOS `say`로 재생한다(브라우저 오디오 unlock 불필요,
// 맥 스피커로 직접 재생돼 탭 포커스와 무관). 설정(soundEnabled)이 켜졌을 때만 호출한다.
import { api } from "./api";

export function say(text: string): void {
  void api.say(text).catch(() => {});
}
