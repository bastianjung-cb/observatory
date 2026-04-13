"use server";

import { exec } from "child_process";
import { resolve as resolvePath } from "path";
import { revalidatePath } from "next/cache";

const PROJECT_ROOT = resolvePath(process.cwd(), "..");

export async function runSync(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(
      `cd "${PROJECT_ROOT}" && uv run python main.py --skip-migrations`,
      { timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Sync failed:", stderr);
          resolve({ success: false, message: "Sync failed. Check server logs for details." });
        } else {
          console.log("Sync output:", stdout);
          revalidatePath("/");
          resolve({ success: true, message: stdout });
        }
      }
    );
  });
}
