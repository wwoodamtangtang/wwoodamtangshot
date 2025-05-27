// src/utils/albums.ts
import exifr from "exifr";
import path from "path";
import type { ImageMetadata } from "astro:assets";

export async function getAlbumImages(albumId: string) {
  // 1) 프로젝트 루트 기준 src/content/albums 폴더를 glob
  const images = import.meta.glob<{ default: ImageMetadata }>(
    "./src/content/albums/**/*.{jpeg,jpg}"
  );

  // 2) albumId 폴더로 필터링
  const entries = Object.entries(images).filter(([filepath]) =>
    filepath.includes(`/src/content/albums/${albumId}/`)
  );

  // 3) 각 이미지에 대해 EXIF 파싱하여 메타정보에 추가
  const resolved = await Promise.all(
    entries.map(async ([filepath, importer]) => {
      // Astro가 제공하는 메타 정보 읽기
      const { default: meta } = await importer();

      // filepath 예시: "./src/content/albums/2025-03-17/DSF7676.jpeg"
      // 앞의 "./" 제거 → "src/content/albums/..."
      const fsPath = filepath.replace(/^\.\//, "");
      // process.cwd()는 빌드 환경에서 프로젝트 루트를 가리킵니다.
      const realPath = path.resolve(process.cwd(), fsPath);

      const exif = await exifr.parse(realPath, [
        "Make",
        "Model",
        "FNumber",
        "ExposureTime",
        "ISO",
        "DateTimeOriginal",
      ]);

      return {
        ...meta,
        exif,
      };
    })
  );

  return resolved;
}