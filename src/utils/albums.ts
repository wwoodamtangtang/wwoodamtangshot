// src/utils/albums.ts
import exifr from "exifr";
import path from "path";
import fs from "fs";

export async function getAlbumImages(albumId: string) {
  // 빌드 타임에 Node.js fs로 파일 목록 직접 읽기 (import.meta.glob 미사용)
  // → Vite가 이미지 파일을 자산으로 분석하지 않아 빌드 속도 대폭 개선
  const albumDir = path.join(process.cwd(), "src", "content", "albums", albumId);

  if (!fs.existsSync(albumDir)) return [];

  const files = fs
    .readdirSync(albumDir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();

  const resolved = await Promise.all(
    files.map(async (filename) => {
      const realPath = path.join(albumDir, filename);

      // EXIF 파싱 (실패 시 빈 객체 반환)
      const exif = await exifr
        .parse(realPath, [
          "Make",
          "Model",
          "FNumber",
          "ExposureTime",
          "ISO",
          "DateTimeOriginal",
        ])
        .catch(() => ({}));

      // 공개 URL 생성: publicDir="src/content" → /albums/albumId/filename
      const urlPath =
        "/albums/" +
        encodeURIComponent(albumId) +
        "/" +
        encodeURIComponent(filename);

      return { src: urlPath, exif: exif || {} };
    })
  );

  return resolved;
}
