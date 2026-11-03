# 출처

## 그림

- 교실 배경, 캐릭터(얼굴·머리·옷·신발) 부품, 협동 게임방 그림은 이 프로젝트를 위해 Codex의 이미지 생성 기능으로 새로 그린 뒤 잘라 쓴 그림입니다. 실제 인물 사진이나 다른 게임의 그림을 쓰지 않았습니다.
- 기존 픽셀 캐릭터, 아이콘, 안경은 코드(Canvas/SVG)로 그렸습니다.

## 소리

- 효과음은 Web Audio API로 직접 합성합니다. 외부 음원·샘플을 쓰지 않습니다.

## 글꼴

- Pretendard: 길형진 / https://github.com/orioncactus/pretendard / SIL OFL 1.1 (`public/fonts/OFL.txt`)
- 주아(Jua): Woowahan Brothers / Google Fonts / SIL OFL 1.1. 퀴즈 연출에 쓰는 글자만 담은 부분 글꼴 (`public/fonts/OFL-Jua.txt`)

## 라이브러리

- Phaser: Phaser Studio / https://phaser.io / MIT
- Colyseus: Endel Dreyer 및 contributors / https://colyseus.io / MIT
- Express: https://expressjs.com / MIT
- QRCode (node-qrcode): https://github.com/soldair/node-qrcode / MIT
- Vite: https://vite.dev / MIT
- PDF.js (`pdfjs-dist`): Mozilla 및 기여자 / https://github.com/mozilla/pdf.js / Apache-2.0 (`public/licenses/pdfjs/`)
- MediaPipe Tasks Vision: Google / https://github.com/google-ai-edge/mediapipe / Apache-2.0

## 모델 (사진 → 비슷한 캐릭터, 학생 기기 안에서만 실행)

- Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Selfie Multiclass (image segmenter): https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- 모델 이용 조건은 위 안내 페이지를 따릅니다.
