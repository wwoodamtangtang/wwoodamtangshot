import exifr from "exifr";
import { fileURLToPath } from "url";

export async function getAlbumImages(albumId: string) {
  // 1. List all album files from collections path
  let images = import.meta.glob<{ default: ImageMetadata }>(
    "../content/albums/**/*.{jpeg,jpg}",
    { eager: false }
  );

  // 2. Filter images by albumId
  images = Object.fromEntries(
    Object.entries(images).filter(([key]) => key.includes(albumId)),
  );

  // 3. Images are promises, so we need to resolve the glob promises and parse EXIF data
  const resolvedImages = await Promise.all(
    Object.entries(images).map(async ([filepath, importer]) => {
      const { default: meta } = await importer();
      const realPath = fileURLToPath(new URL(filepath, import.meta.url));
      const exif = await exifr.parse(realPath, [
        "Make",
        "Model",
        "FNumber",
        "ExposureTime",
        "ISO",
        "DateTimeOriginal",
      ]);
      return { ...meta, exif };
    })
  );

  // 4. Shuffle images with random order
  // resolvedImages.sort(() => Math.random() - 0.5);

  return resolvedImages;
}