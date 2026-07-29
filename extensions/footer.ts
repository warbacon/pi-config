import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ─── Constants ───────────────────────────────────────────────────────────────

const THINKING_COLOR_MAP: Record<string, ThemeColor> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingXhigh",
};

const MAX_PATH_PARTS = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPath(cwd: string): { dir: string; name: string } {
  const home =
    process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  cwd = cwd.replace(home || "", "~");
  const isWindows = process.platform === "win32";
  const sep = isWindows ? "\\" : "/";
  const parts = cwd.split(sep);
  const trimmed =
    parts.length > MAX_PATH_PARTS ? parts.slice(-MAX_PATH_PARTS) : parts;
  const name = trimmed[trimmed.length - 1];
  const dir = trimmed.length > 1 ? trimmed.slice(0, -1).join(sep) + sep : "";
  return { dir, name };
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "?";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return k >= 10 ? `${Math.trunc(k)}K` : `${k.toFixed(1)}K`;
  }
  return `${tokens}`;
}

function formatUsage(usage: {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}): string {
  const used = formatTokens(usage.tokens);
  const total = formatTokens(usage.contextWindow);
  const pct = usage.percent !== null ? `${Math.round(usage.percent)}%` : "";
  return pct ? `${used}/${total} (${pct})` : `${used}/${total}`;
}

// ─── Token Speed Tracker ─────────────────────────────────────────────────────

interface TokenSpeedTracker {
  readonly speed: number;
  onToken(): void;
  reset(): void;
}

function createTokenSpeedTracker(): TokenSpeedTracker {
  let speed = 0;
  const timestamps: number[] = [];
  const windowMs = 2000;

  return {
    get speed() {
      return speed;
    },

    onToken() {
      const now = Date.now();
      timestamps.push(now);

      const cutoff = now - windowMs;
      const idx = timestamps.findIndex((t) => t > cutoff);
      if (idx !== -1) {
        timestamps.splice(0, idx);
      }

      if (timestamps.length >= 2) {
        const duration =
          (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
        if (duration > 0) {
          speed = timestamps.length / duration;
        }
      }
    },

    reset() {
      speed = 0;
      timestamps.length = 0;
    },
  };
}

// ─── Footer State ────────────────────────────────────────────────────────────

interface FooterState {
  modelId: string;
  provider: string;
  thinkingLevel: string | undefined;
  supportsReasoning: boolean;
  isGenerating: boolean;
}

function createFooterState(): FooterState {
  return {
    modelId: "",
    provider: "",
    thinkingLevel: undefined,
    supportsReasoning: false,
    isGenerating: false,
  };
}

function updateModelInfo(
  state: FooterState,
  model: { id: string; provider: string; reasoning?: boolean } | undefined,
  pi: ExtensionAPI,
) {
  state.modelId = model?.id ?? "";
  state.provider = model?.provider ?? "";
  state.supportsReasoning = !!model?.reasoning;
  state.thinkingLevel = pi.getThinkingLevel();
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderFooter(
  width: number,
  state: FooterState,
  tracker: TokenSpeedTracker,
  cwd: { dir: string; name: string },
  gitBranch: string | undefined,
  contextUsage:
    | {
        tokens: number | null;
        contextWindow: number;
        percent: number | null;
      }
    | undefined,
  theme: any,
): string {
  const cwdComponent = cwd.name
    ? theme.fg("dim", cwd.dir) + theme.fg("mdLink", theme.bold(cwd.name))
    : theme.fg("dim", cwd.dir);

  const branchComponent = gitBranch
    ? theme.fg("mdLinkUrl", theme.bold(`(${gitBranch})`))
    : "";

  const modelComponent = theme.bold(theme.fg("accent", state.modelId));

  let thinkingComponent = "";
  if (state.supportsReasoning && state.thinkingLevel) {
    const colorKey = THINKING_COLOR_MAP[state.thinkingLevel] ?? "thinkingLow";
    thinkingComponent =
      state.thinkingLevel !== "off"
        ? theme.fg(colorKey, state.thinkingLevel)
        : "";
  }

  const providerComponent = theme.fg("dim", `(${state.provider})`);

  const contextUsageComponent =
    contextUsage && theme.fg("dim", formatUsage(contextUsage));

  const speedComponent =
    state.isGenerating && tracker.speed > 0
      ? theme.fg("success", `${Math.round(tracker.speed)} t/s`)
      : "";

  const left = [cwdComponent, branchComponent].join(" ");
  const center = contextUsageComponent ?? "";
  const right = [
    providerComponent,
    modelComponent,
    thinkingComponent,
    speedComponent,
  ]
    .filter(Boolean)
    .join(" ");

  const leftWidth = visibleWidth(left);
  const centerWidth = visibleWidth(center);
  const rightWidth = visibleWidth(right);

  const idealCenterStart = Math.floor((width - centerWidth) / 2);
  const gap1 = Math.max(1, idealCenterStart - leftWidth);
  const gap2 = Math.max(1, width - leftWidth - gap1 - centerWidth - rightWidth);

  return truncateToWidth(
    left + " ".repeat(gap1) + center + " ".repeat(gap2) + right,
    width,
  );
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let tuiRef: { requestRender(): void } | null = null;
  const state = createFooterState();
  const tracker = createTokenSpeedTracker();

  pi.on("model_select", (_event) => {
    updateModelInfo(state, _event.model, pi);
    tuiRef?.requestRender();
  });

  pi.on("thinking_level_select", (event) => {
    state.thinkingLevel = event.level;
    tuiRef?.requestRender();
  });

  pi.on("turn_start", () => {
    tracker.reset();
    state.isGenerating = true;
  });

  pi.on("turn_end", () => {
    state.isGenerating = false;
    tracker.reset();
  });

  pi.on("message_update", () => {
    if (!state.isGenerating) return;
    tracker.onToken();
    tuiRef?.requestRender();
  });

  pi.on("session_start", (_event, ctx) => {
    updateModelInfo(state, ctx.model, pi);

    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;

      const branchUnsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose() {
          branchUnsub?.();
        },
        invalidate() {},
        render(width: number) {
          const cwd = formatPath(ctx.cwd);
          const gitBranch = footerData.getGitBranch() || "";
          const contextUsage = ctx.getContextUsage();

          return [
            renderFooter(
              width,
              state,
              tracker,
              cwd,
              gitBranch,
              contextUsage,
              theme,
            ),
          ];
        },
      };
    });
  });
}
