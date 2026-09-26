import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { LOGO, PORTRAIT } from "./art.js";
import { eth, publicClient } from "./chain.js";
import { accountFromKey, launchCoin } from "./launch.js";

const PURPLE = "\x1b[38;2;186;140;255m";
const DIM = "\x1b[38;2;150;140;170m";
const HOT = "\x1b[38;2;244;236;255m";
const RESET = "\x1b[0m";

let wallet = null;
let balanceText = "";

function short(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function paint(selected, note) {
  const wide = (output.columns || 80) >= 96;
  output.write(`\x1b[2J\x1b[H${RESET}`);
  for (const line of LOGO) output.write(`${PURPLE}${line}${RESET}\n`);
  output.write("\n");

  const menu = [
    `${DIM}Launch a coin on clank.trade${RESET}`,
    "",
    row(0, selected, "1  Connect wallet"),
    row(1, selected, "2  Launch token"),
    "",
    wallet
      ? `${DIM}Wallet${RESET}  ${HOT}${short(wallet.account.address)}${RESET}`
      : `${DIM}Wallet${RESET}  not connected`,
    wallet ? `${DIM}Balance${RESET}  ${balanceText || "..."}` : "",
    "",
    note ? `${HOT}${note}${RESET}` : "",
    "",
    `${DIM}up/down select    Enter    q quit${RESET}`,
  ];

  if (!wide) {
    for (const line of PORTRAIT) output.write(`${line}\n`);
    output.write("\n");
    for (const line of menu) output.write(`${line}\n`);
    return;
  }

  const height = Math.max(PORTRAIT.length, menu.length);
  for (let i = 0; i < height; i += 1) {
    const left = PORTRAIT[i] ?? "";
    const right = menu[i] ?? "";
    output.write(`${left}${RESET}  ${right}\n`);
  }
}

function row(index, selected, label) {
  if (index === selected) return `${HOT}> ${label}${RESET}`;
  return `${DIM}  ${label}${RESET}`;
}

function readKey() {
  return new Promise((resolve) => {
    output.write("\x1b[?25l");
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (key) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
      resolve(key);
    };
    input.on("data", onData);
  });
}

function readSecret(prompt) {
  return new Promise((resolve) => {
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let buf = "";
    const finish = (value) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(value);
    };
    const onData = (chunk) => {
      if (chunk === "\u0003") {
        finish(null);
        process.exitCode = 130;
        return;
      }
      if (chunk === "\u001b") {
        finish(null);
        return;
      }
      const cut = chunk.search(/[\r\n]/);
      if (cut >= 0) {
        buf += chunk.slice(0, cut);
        finish(buf);
        return;
      }
      if (chunk === "\u007f" || chunk === "\b") {
        buf = buf.slice(0, -1);
        return;
      }
      if (chunk.startsWith("\u001b")) return;
      buf += chunk;
      output.write("*".repeat(chunk.length));
    };
    input.on("data", onData);
  });
}

async function refreshBalance() {
  if (!wallet) {
    balanceText = "";
    return;
  }
  balanceText = "reading...";
  try {
    const wei = await publicClient().getBalance({ address: wallet.account.address });
    balanceText = eth(wei);
  } catch {
    balanceText = "unavailable";
  }
}

function form() {
  input.setRawMode(false);
  input.resume();
  return readline.createInterface({ input, output, terminal: true });
}

async function connect() {
  output.write(`\x1b[2J\x1b[H${RESET}`);
  output.write(`${PURPLE}Connect wallet${RESET}\n\n`);
  output.write(`${DIM}Paste a private key. Each character is shown as *. Esc cancels.${RESET}\n`);
  output.write(`${DIM}The key stays in this session only. It is not written to disk.${RESET}\n\n`);
  const key = await readSecret(`${HOT}Private key${RESET}  `);
  if (!key) return "Connect cancelled.";
  try {
    const opened = accountFromKey(key);
    wallet = opened;
    await refreshBalance();
    return `Connected ${short(opened.account.address)}`;
  } catch (error) {
    return error.message;
  }
}

function clean(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

async function launchForm() {
  if (!wallet) return "Connect a wallet first.";
  output.write(`\x1b[2J\x1b[H${RESET}`);
  output.write(`${PURPLE}Launch token${RESET}\n`);
  output.write(`${DIM}Wallet ${short(wallet.account.address)}  ${balanceText}${RESET}\n\n`);
  const rl = form();
  try {
    const name = clean(await rl.question("Coin name: "));
    const symbol = clean(await rl.question("Ticker: "));
    const image = clean(await rl.question("Image path (PNG, JPEG, WebP): "));
    const twitter = clean(await rl.question("Twitter (leave empty to skip): "));
    const website = clean(await rl.question("Website (leave empty to skip): "));
    const buy = clean(await rl.question("ETH to buy (leave empty for 0): "));
    const confirm = clean(await rl.question("\nType YES to send the transaction: "));
    if (confirm !== "YES") return "Transaction was not sent.";
    output.write("\n");
    const result = await launchCoin({
      name,
      symbol,
      image,
      twitter,
      website,
      buy,
      privateKey: wallet.privateKey,
      yes: true,
      onStatus: (text) => output.write(`${DIM}${text}${RESET}\n`),
    });
    output.write("\n");
    output.write(`${HOT}${result.name} ($${result.symbol})${RESET}\n`);
    output.write(`Token  ${result.token}\n`);
    output.write(`Page   ${result.coinUrl}\n`);
    if (result.txUrl) output.write(`Tx     ${result.txUrl}\n`);
    if (result.reason) output.write(`${result.reason}\n`);
    if (result.sent) output.write("Launch is onchain.\n");
    await rl.question("\nPress Enter to return.");
    return result.sent ? "Launch is onchain." : result.reason || "Transaction was not sent.";
  } catch (error) {
    const message = error?.shortMessage || error?.message || String(error);
    await rl.question(`\n${message}\n\nPress Enter to return.`);
    return message;
  } finally {
    rl.close();
  }
}

async function home() {
  let selected = 0;
  let note = "";
  if (process.env.CLANK_PRIVATE_KEY) {
    try {
      wallet = accountFromKey(process.env.CLANK_PRIVATE_KEY);
      note = `Using wallet ${short(wallet.account.address)} from the environment.`;
    } catch (error) {
      note = error.message;
    }
  }
  await refreshBalance();
  while (true) {
    paint(selected, note);
    const key = await readKey();
    if (key === "\u0003" || key === "q" || key === "Q") return;
    if (key === "\u001b[A" || key === "k") selected = 0;
    else if (key === "\u001b[B" || key === "j") selected = 1;
    else if (key === "1" || ((key === "\r" || key === "\n") && selected === 0)) {
      selected = 0;
      note = await connect();
      await refreshBalance();
    } else if (key === "2" || ((key === "\r" || key === "\n") && selected === 1)) {
      selected = 1;
      note = await launchForm();
      await refreshBalance();
    }
  }
}

export async function openUi() {
  if (!input.isTTY || !output.isTTY) {
    output.write("Open a terminal and run clank-trade to open the screen.\n");
    return;
  }
  output.write("\x1b[?1049h");
  try {
    await home();
  } finally {
    if (input.isTTY) {
      input.setRawMode(false);
      input.pause();
    }
    output.write(`\x1b[0m\x1b[?25h\x1b[?1049l`);
  }
}
