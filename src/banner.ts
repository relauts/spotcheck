const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const UNDERLINE = "\x1b[4m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[K";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const CHECK = "✓";
const SPINNER_MS = 80;

const TITLE = [
  "██████╗ ███████╗██╗      █████╗ ██╗   ██╗████████╗███████╗",
  "██╔══██╗██╔════╝██║     ██╔══██╗██║   ██║╚══██╔══╝██╔════╝",
  "██████╔╝█████╗  ██║     ███████║██║   ██║   ██║   ███████╗",
  "██╔══██╗██╔══╝  ██║     ██╔══██║██║   ██║   ██║   ╚════██║",
  "██║  ██║███████╗███████╗██║  ██║╚██████╔╝   ██║   ███████║",
  "╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝",
].join("\n");

export const STORY_DOWNLOADING = "Downloading required packages...";
export const STORY_COMPLETE = "Installation complete.";
export const STORY_GET_STARTED = "Click below link to get started.";

export interface StatusStream {
  readonly isTTY?: boolean;
  write(text: string): unknown;
}

export function useColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  return stream.isTTY === true && process.env.NO_COLOR === undefined;
}

function paint(text: string, codes: string, color: boolean): string {
  if (!color) {
    return text;
  }
  return `${codes}${text}${RESET}`;
}

function hyperlink(url: string, color: boolean): string {
  const shown = color ? `${UNDERLINE}${CYAN}${url}${RESET}` : url;
  return `\x1b]8;;${url}\x1b\\${shown}\x1b]8;;\x1b\\`;
}

export function formatTitle(color = useColor()): string {
  return `\n${paint(TITLE, `${BOLD}${CYAN}`, color)}\n\n`;
}

export function formatGetStarted(uiUrl: string, color = useColor()): string {
  return `\n${STORY_GET_STARTED}\n${hyperlink(uiUrl, color)}\n`;
}

export function formatStatusLine(
  label: string,
  done: boolean,
  frame: string = FRAMES[0],
  color = true,
): string {
  const mark = done ? CHECK : frame;
  return paint(`${mark}  ${label}`, CYAN, color);
}

export function printTitle(): void {
  console.info(formatTitle());
}

export function printGetStarted(uiUrl: string): void {
  console.info(formatGetStarted(uiUrl));
}

export async function runStatusStep<T>(
  label: string,
  work: () => Promise<T>,
  stream: StatusStream = process.stdout,
): Promise<T> {
  const color = useColor(stream);
  const doneLine = `${formatStatusLine(label, true, FRAMES[0], color)}\n\n`;

  if (stream.isTTY !== true) {
    const result = await work();
    stream.write(doneLine);
    return result;
  }

  let index = 0;
  const render = (done: boolean): void => {
    const frame = FRAMES[index] ?? FRAMES[0];
    stream.write(`${CLEAR_LINE}${formatStatusLine(label, done, frame, color)}`);
  };

  stream.write(HIDE_CURSOR);
  render(false);
  const timer = setInterval(() => {
    index = (index + 1) % FRAMES.length;
    render(false);
  }, SPINNER_MS);

  try {
    const result = await work();
    clearInterval(timer);
    stream.write(`${CLEAR_LINE}${doneLine}`);
    return result;
  } catch (error: unknown) {
    clearInterval(timer);
    stream.write(`${CLEAR_LINE}${formatStatusLine(label, false, FRAMES[0], color)}\n\n`);
    throw error;
  } finally {
    stream.write(SHOW_CURSOR);
  }
}
