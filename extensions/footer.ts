import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatPath(cwd: string): { dir: string; name: string } {
  const home = process.platform === "win32"
    ? process.env.USERPROFILE
    : process.env.HOME;
  cwd = cwd.replace(home || "", "~");
  const isWindows = process.platform === "win32";
  const sep = isWindows ? "\\" : "/";
  const parts = cwd.split(sep);
  const maxParts = 3;
  const trimmed = parts.length > maxParts ? parts.slice(-maxParts) : parts;
  const name = trimmed[trimmed.length - 1];
  const dir = trimmed.length > 1 ? trimmed.slice(0, -1).join(sep) + sep : "";
  return { dir, name };
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "?";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.trunc(tokens / 1000).toFixed(1)}k`;
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
  return pct ? `(${pct}) ${used}/${total}` : `${used}/${total}`;
}

export default function (pi: ExtensionAPI) {
  let tuiRef: { requestRender(): void } | null = null;
  let currentModelId = "";
  let currentModelProvider = "";

  pi.on("model_select", async (event) => {
    currentModelId = event.model.id;
    currentModelProvider = event.model.provider;
    tuiRef?.requestRender();
  });

  pi.on("session_start", async (_event, ctx) => {
    currentModelId = ctx.model?.id || "";
    currentModelProvider = ctx.model?.provider || "";

    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;

      const branchUnsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose() {
          branchUnsub?.();
        },
        invalidate() {},
        render(width: number) {
          const { dir, name } = formatPath(ctx.cwd);
          const cwdComponent = name
            ? theme.fg("dim", dir) + theme.fg("mdLink", theme.bold(name))
            : theme.fg("dim", ctx.cwd);

          const branchComponent = footerData.getGitBranch()
            ? theme.fg(
                "mdLinkUrl",
                theme.bold(`(${footerData.getGitBranch()})`),
              )
            : "";

          const modelComponent = `${theme.fg("muted", `${currentModelProvider}/`)}${theme.fg("accent", currentModelId)}`;

          const contextUsage = ctx.getContextUsage();
          const usageComponent =
            contextUsage && theme.fg("dim", formatUsage(contextUsage));

          const left = [cwdComponent, branchComponent].join(" ");
          const center = usageComponent;
          const right = modelComponent;
          const leftWidth = visibleWidth(left);
          const centerWidth = visibleWidth(center || "");
          const rightWidth = visibleWidth(right);
          const leftPad = Math.floor(
            (width - leftWidth - centerWidth - rightWidth) / 2,
          );
          const rightPad =
            width - leftWidth - centerWidth - rightWidth - leftPad;
          const gap1 = " ".repeat(Math.max(0, leftPad));
          const gap2 = " ".repeat(Math.max(0, rightPad));

          return [truncateToWidth(left + gap1 + center + gap2 + right, width)];
        },
      };
    });
  });
}
