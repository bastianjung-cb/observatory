"use server";

import { revalidatePath } from "next/cache";
import { upsertModelPricing, deleteModelPricing } from "@/lib/queries/activities";
import { initAutoSync, startAutoSync, stopAutoSync, getAutoSyncStatus } from "@/lib/auto-sync";

export async function saveModelPricing(formData: FormData) {
  const modelId = formData.get("model_id") as string;
  const inputPrice = parseFloat(formData.get("input_price") as string);
  const outputPrice = parseFloat(formData.get("output_price") as string);
  const cacheReadPrice = formData.get("cache_read_price")
    ? parseFloat(formData.get("cache_read_price") as string)
    : null;
  const reasoningPrice = formData.get("reasoning_price")
    ? parseFloat(formData.get("reasoning_price") as string)
    : null;

  await upsertModelPricing(modelId, inputPrice, outputPrice, cacheReadPrice, reasoningPrice);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function removeModelPricing(formData: FormData) {
  const id = parseInt(formData.get("id") as string, 10);
  await deleteModelPricing(id);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function toggleAutoSync() {
  await initAutoSync();
  const status = await getAutoSyncStatus();
  if (status.enabled) {
    await stopAutoSync();
  } else {
    await startAutoSync();
  }
  revalidatePath("/settings");
  return await getAutoSyncStatus();
}

export async function fetchAutoSyncStatus() {
  await initAutoSync();
  return getAutoSyncStatus();
}
