// src/utils/albums.ts
import exifr from "exifr";
import path from "path";
import type { ImageMetadata } from "astro:assets";

export async function getAlbumImages(albumId: string) {
  // 1) 이 파일(src/utils) 기준으로 한 칸 위 폴더(src) 내 content/albums 을 glob
  const images = import.meta.glob<{ default: ImageMetadata }>(
    "../content/albums/**/*.{jpeg,jpg}"
  );

  // 2) albumId 포함된 파일만 필터
  const entries = Object.entries(images).filter(([filepath]) =>
    filepath.includes(`/content/albums/${albumId}/`)
  );

  // 3) 각 이미지마다 EXIF 파싱 & meta 합치기
  const resolved = await Promise.all(
    entries.map(async ([filepath, importer]) => {
      // Astro가 제공하는 이미지 메타
      const { default: meta } = await importer();

      // filepath 예: "../content/albums/2025-03-17/DSF7676.jpeg"
      // 앞의 "../" 제거 → "content/albums/2025-03-17/DSF7676.jpeg"
      let relPath = filepath.replace(/^\.\.\//, "");
      // 실제 파일 시스템 경로: 프로젝트 루트/src/content/...
      const realPath = path.join(process.cwd(), "src", relPath);

      // EXIF 파싱
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