import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "CRX Helper",
    description: "Capture page HTML via one click",
    action: {
      default_title: "Capture Page HTML",
    },
    // Add downloads permission so background can save files reliably
    permissions: ["downloads"],
  },
});
