import { defineConfig } from "vite";

// Relative paths so the built app also works when it is loaded from inside the Even Hub package.
export default defineConfig({ base: "./" });
