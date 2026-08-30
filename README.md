# Veil

NudeNet TFJS로 사진을 브라우저 안에서만 분석하고 검열하는 로컬 우선 웹 편집기입니다. 선택한 사진과 추론 결과는 서버로 업로드되지 않습니다.

## 기능

- NudeNet TFJS 로컬 추론 및 편집 가능한 자동 검열 사각형
- 사각형 이동, 모서리 크기 조절, 선택 삭제
- 흰색 검열 브러시와 검열 마스크 전용 지우개
- 최대 60단계 실행 취소/다시 실행
- 화면 배율과 무관한 원본 해상도 PNG 저장
- JPG, PNG, WebP 파일 선택 및 드래그 앤 드롭

## 실행

```powershell
pnpm install
pnpm dev
```

프로덕션 빌드는 `pnpm build`로 생성합니다. NudeNet 모델은 `public/models/nudenet`에 포함되어 있어 실행 중 외부 모델 서버에 접속하지 않습니다.

## 단축키

- `V`: 선택/이동
- `B`: 흰색 브러시
- `E`: 마스크 지우개
- `Delete`: 선택한 AI 사각형 삭제
- `Ctrl+Z`: 실행 취소
- `Ctrl+Shift+Z`: 다시 실행
