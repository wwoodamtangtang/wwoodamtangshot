import { defineCollection, z } from "astro:content";

const albums = defineCollection({
  type: "data",
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      cover: z.string(), // ✅ 문자열 경로로 바꿔야 src/content 내부 이미지 사용 가능
    }),
});

export const collections = {
  albums,
};