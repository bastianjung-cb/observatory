"use server";

import { revalidatePath } from "next/cache";
import { upsertModelPricing, deleteModelPricing } from "@/lib/queries/activities";
import { initAutoSync, startAutoSync, stopAutoSync, getAutoSyncStatus } from "@/lib/auto-sync";

function parseRequiredPrice(formData: FormData, field: string): number {
  const raw = (formData.get(field) as string | null)?.trim();
  if (!raw) throw new Error(`${field} is required`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number (got ${JSON.stringify(raw)})`);
  }
  return n;
}

function parseOptionalPrice(formData: FormData, field: string): number | null {
  const raw = (formData.get(field) as string | null)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number (got ${JSON.stringify(raw)})`);
  }
  return n;
}

export async function saveModelPricing(formData: FormData) {
  const modelId = (formData.get("model_id") as string | null)?.trim();
  if (!modelId) throw new Error("model_id is required");

  const inputPrice = parseRequiredPrice(formData, "input_price");
  const outputPrice = parseRequiredPrice(formData, "output_price");
  const cacheReadPrice = parseOptionalPrice(formData, "cache_read_price");
  const reasoningPrice = parseOptionalPrice(formData, "reasoning_price");

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
