export const ASCII_ART = `██╗  ██╗███████╗███████╗███████╗███████╗████████╗ ███████╗
██║  ██║██╔════╝██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔═══██╗
███████║█████╗  █████╗  █████╗  ███████╗   ██║   ██║   ██║
██╔══██║██╔══╝  ██╔══╝  ██╔══╝  ╚════██║   ██║   ██║   ██║
██║  ██║███████╗██║     ███████╗███████║   ██║   ╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝   ╚═╝    ╚══════╝`;

const AMBER = "\x1b[38;5;214m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function printBanner(webUrl: string): void {
  console.log(AMBER + ASCII_ART + RESET);
  console.log(`${DIM}  a forja de agentes opencode · ${webUrl}${RESET}`);
  console.log("");
}
