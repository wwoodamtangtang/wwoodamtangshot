import { defineConfig } from "astro/config";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  site: "https://0xsbock.github.io",
  base: "wwoodamtangshot",
  integrations: [tailwind()],
});
