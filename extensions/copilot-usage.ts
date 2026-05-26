/**
 * Copilot Usage Extension for pi
 *
 * Shows GitHub Copilot premium request usage in the pi status bar.
 * Uses pi's existing Copilot OAuth token — no separate PAT needed.
 *
 * Format: "Copilot: 13%" with warning indicators at 75%+ and 90%+
 * Refreshes every 60 seconds. Run /copilot-usage to force a refresh.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STATUS_KEY = "copilot-usage";
const REFRESH_MS = 60 * 1000; // 1 minute
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

interface QuotaSnapshot {
  percent_remaining: number;
  remaining: number;
  entitlement: number;
  overage_count: number;
  unlimited: boolean;
}

interface CopilotUser {
  quota_snapshots: {
    premium_interactions?: QuotaSnapshot;
  };
}

interface AuthJson {
  "github-copilot"?: {
    refresh?: string;
  };
}

async function getOAuthToken(): Promise<string | null> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8");
    const auth = JSON.parse(raw) as AuthJson;
    return auth["github-copilot"]?.refresh ?? null;
  } catch {
    return null;
  }
}

async function fetchAndSetStatus(ctx: ExtensionContext): Promise<void> {
  const token = await getOAuthToken();

  if (!token) {
    ctx.ui.setStatus(STATUS_KEY, "Copilot: not logged in (run /login)");
    return;
  }

  try {
    const res = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      ctx.ui.setStatus(STATUS_KEY, `Copilot: API error ${res.status}`);
      return;
    }

    const data = (await res.json()) as CopilotUser;
    const quota = data.quota_snapshots?.premium_interactions;

    if (!quota) {
      ctx.ui.setStatus(STATUS_KEY, "Copilot: no quota data");
      return;
    }

    if (quota.unlimited) {
      ctx.ui.setStatus(STATUS_KEY, "Copilot: unlimited");
      return;
    }

    const pct = Math.round(100 - quota.percent_remaining);
    const overage =
      quota.overage_count > 0 ? ` +${quota.overage_count}over` : "";
    const warn = pct >= 90 ? " !" : pct >= 75 ? " ~" : "";

    ctx.ui.setStatus(STATUS_KEY, `Copilot: ${pct}%${overage}${warn}`);
  } catch {
    ctx.ui.setStatus(STATUS_KEY, "Copilot: fetch failed");
  }
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", async (_event, ctx) => {
    await fetchAndSetStatus(ctx);

    if (timer) clearInterval(timer);
    timer = setInterval(() => fetchAndSetStatus(ctx), REFRESH_MS);
  });

  pi.on("session_shutdown", async () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });

  pi.registerCommand("copilot-usage", {
    description: "Refresh Copilot usage in the status bar",
    handler: async (_args, ctx) => {
      await fetchAndSetStatus(ctx);
    },
  });
}
