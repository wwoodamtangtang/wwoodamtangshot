import { defineCollection, z } from "astro:content";

const albums = defineCollection({
  type: "data",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    cover: z.string(),
  }),
});

export const collections = {
  albums,
};