# Charpet MVP

Windows용 커플 D-Day 데스크톱 위젯입니다. Tauri가 투명한 `widget` 창과 숨겨진 `settings` 창을 만들고, React는 창 라벨에 따라 각각의 UI를 렌더링합니다.

## 구조

- `src/widget`: 투명 위젯, 클릭/드래그 제스처와 캐릭터 애니메이션
- `src/settings`: 이미지·날짜·배치·말풍선 설정 화면
- `src/lib/settings.ts`: Tauri Store의 `charpet-settings.json` 읽기/쓰기
- `src-tauri/src/lib.rs`: 이미지 앱 데이터 폴더 복사, 윈도우 위치 저장/복원, 항상 위·클릭 통과, 트레이 메뉴

## 데이터 모델

`AppSettings`는 기념일 이름/날짜/타입, 1일째 계산, 위젯 표시 상태와 A/B `CharacterSettings`를 보관합니다. 각 캐릭터는 복사된 이미지의 절대 경로, 배율, X/Y 보정, z-index, 기본·클릭·드래그 말풍선을 가집니다. 위젯 좌표는 별도 `widget-position.json`에 저장합니다.

## 실행

```powershell
pnpm install
pnpm tauri dev
```

이미지는 PNG/JPG/WebP만 허용하며 최대 10MB입니다. 선택 시 앱 데이터 폴더의 `characters/a.*` 또는 `characters/b.*`로 복사됩니다.
