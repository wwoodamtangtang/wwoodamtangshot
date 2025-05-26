import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "media",    // ← use prefers-color-scheme
  content: [
    "./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"
  ],
  theme: {
    extend: {
      fontSize: {
        "5xl": ["1.5rem", { lineHeight: "2rem", fontWeight: "400" }],
        "xl":  ["0.8rem", { lineHeight: "1.2rem", fontWeight: "300" }],
      },
    },
  },
  plugins: [
    // this plugin injects global <base> styles
    plugin(({ addBase, theme }) => {
      addBase({
        "html": {
          backgroundColor: theme("colors.slate.50"),
          color:            theme("colors.slate.800"),
        },
        "@media (prefers-color-scheme: dark)": {
          "html": {
            backgroundColor: theme("colors.slate.900"),
            color:            theme("colors.slate.200"),
          },
        },
      });
    }),
  ],
};