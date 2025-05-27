import { defineConfig } from "astro/config";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  site: "https://wwoodamtangshot-git-main-damwoos-projects.vercel.app",
  publicDir: "src/content",
  base: "/",
  integrations: [tailwind()],
});
