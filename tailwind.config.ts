import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#161616",
        paper: "#f7f2ea",
        moss: "#63755f",
        clay: "#b76f52"
      },
      boxShadow: {
        soft: "0 24px 80px rgba(37, 31, 26, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
