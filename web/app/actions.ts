"use server";

import { exec } from "child_process";
import { revalidatePath } from "next/cache";

export async function runSync(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(
      "cd /mnt/observer_app && uv run python main.py --skip-migrations",
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
