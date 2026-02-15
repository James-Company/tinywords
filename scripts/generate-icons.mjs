/**
 * TinyWords 앱 아이콘 생성 스크립트
 *
 * SVG 기반으로 다양한 크기의 PNG 아이콘을 생성합니다.
 * 실행: node scripts/generate-icons.mjs
 *
 * 참고: 프로덕션에서는 디자이너가 만든 실제 아이콘으로 교체하세요.
 * 이 스크립트는 개발/테스트용 플레이스홀더 아이콘을 생성합니다.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const ICONS_DIR = join(import.meta.dirname, "..", "web", "icons");

// 브랜드 색상 (styles.css 기준)
const BG_COLOR = "#6E5B45";
const TEXT_COLOR = "#FFFDF8";

function generateSvg(size) {
  const fontSize = Math.round(size * 0.35);
  const subFontSize = Math.round(size * 0.12);
  const radius = Math.round(size * 0.18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG_COLOR}"/>
  <text x="50%" y="42%" text-anchor="middle" dominant-baseline="middle"
        font-family="serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}">Tw</text>
  <text x="50%" y="68%" text-anchor="middle" dominant-baseline="middle"
        font-family="sans-serif" font-size="${subFontSize}" fill="${TEXT_COLOR}" opacity="0.8">TinyWords</text>
</svg>`;
}

mkdirSync(ICONS_DIR, { recursive: true });

for (const size of SIZES) {
  const svg = generateSvg(size);
  const filename = `icon-${size}x${size}.svg`;
  writeFileSync(join(ICONS_DIR, filename), svg);
  console.log(`✓ ${filename}`);
}

// favicon용 SVG도 생성
writeFileSync(join(ICONS_DIR, "favicon.svg"), generateSvg(32));
console.log("✓ favicon.svg");

console.log(`\n아이콘이 ${ICONS_DIR}에 생성되었습니다.`);
console.log(
  "\n⚠️  SVG 아이콘이 생성되었습니다. 프로덕션 배포 시에는 PNG로 변환하거나",
);
console.log("   디자이너가 제작한 실제 아이콘으로 교체해주세요.");
console.log(
  "   PNG 변환: sharp, imagemagick 등을 사용하거나 https://realfavicongenerator.net 이용",
);
