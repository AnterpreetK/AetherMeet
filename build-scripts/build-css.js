#!/usr/bin/env node

/**
 * Build script for Tailwind CSS
 * This script handles CSS compilation for both development and production
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const inputFile = "./public/css/style.css";
const outputFile = "./public/css/compiled.css";

console.log("📦 Building CSS with Tailwind...");

try {
  // Ensure output directory exists
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Try to use the installed tailwindcss
  const tailwindPath = path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    "tailwindcss"
  );
  const isWindows = process.platform === "win32";
  const tailwindCmd = isWindows ? `"${tailwindPath}.cmd"` : tailwindPath;

  // Check if tailwindcss exists
  const tailwindExists = fs.existsSync(
    isWindows ? `${tailwindPath}.cmd` : tailwindPath
  );

  if (tailwindExists) {
    const command = `${tailwindCmd} -i ${inputFile} -o ${outputFile} --minify`;
    console.log(`Running: ${command}`);
    execSync(command, { stdio: "inherit" });
  } else {
    // Fallback: create a basic CSS file if Tailwind is not available
    console.warn("⚠️  Tailwind CSS not found, creating basic CSS file...");

    const basicCSS = `
/* Basic compiled CSS - Tailwind not available */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; }
    `.trim();

    fs.writeFileSync(outputFile, basicCSS);
    console.log(
      "⚠️  Created basic CSS file. Install Tailwind CSS for full styling."
    );
  }

  console.log("✅ CSS build completed successfully");
} catch (error) {
  console.error("❌ Error building CSS:", error.message);
  process.exit(1);
}
