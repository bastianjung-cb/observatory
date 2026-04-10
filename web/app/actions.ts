"use server";

import { exec } from "child_process";
import { revalidatePath } from "next/cache";

export async function runSync(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(
      "cd /mnt/observer_app && uv run python main.py",
      { timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Sync failed:", stderr);
          resolve({ success: false, message: stderr || error.message });
        } else {
          console.log("Sync output:", stdout);
          revalidatePath("/");
          resolve({ success: true, message: stdout });
        }
      }
    );
  });
}
