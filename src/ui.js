import { stdin as input, stdout as output } from "node:process";
import { LOGO } from "./art.js";
import { eth, publicClient } from "./chain.js";
import { accountFromKey, launchCoin } from "./launch.js";
import { portraitImage } from "./sixel.js";

const PURPLE = "\x1b[38;2;186;140;255m";
const DIM = "\x1b[38;2;150;140;170m";
const HOT = "\x1b[38;2;244;236;255m";
const RESET = "\x1b[0m";

let wallet = null;
let balanceText = "";

function short(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const PANEL_W = 34;
const GAP = 4;

let picture = null;

function place(row, col, text) {
  output.write(`\x1b[${row};${col}H${text}${RESET}`);
}

function clip(text, width) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (clean.length <= width) return text;
  return `${clean.slice(0, width - 1)}…`;
}

function menuLines(selected, note) {
  const address = wallet ? short(wallet.account.address) : "not connected";
  const balance = wallet ? balanceText || "..." : "-";
  const lines = [
    `${HOT}CLANK${RESET}`,
    `${DIM}Launch a coin on clank.trade${RESET}`,
    "",
    row(0, selected, "Connect wallet"),
    row(1, selected, "Launch token"),
  ];
  if (wallet) lines.push(row(2, selected, "Log out"));
  lines.push(
    "",
    `${DIM}Wallet${RESET}`,
    `  ${wallet ? HOT : DIM}${address}${RESET}`,
    `${DIM}Balance${RESET}`,
    `  ${DIM}${balance}${RESET}`,
    "",
    note ? `${HOT}${clip(note, PANEL_W - 2)}${RESET}` : "",
    "",
    `${DIM}up/down    enter    q${RESET}`,
  );
  return lines;
}

function paint(selected, note) {
  const columns = output.columns || 100;
  const menu = menuLines(selected, note);
  const logoW = Math.max(...LOGO.map((line) => line.length));
  output.write(`\x1b[2J\x1b[3J\x1b[H${RESET}`);

  if (!picture) {
    let row = 2;
    for (const line of LOGO) {
      place(row, 2, `${PURPLE}${line}`);
      row += 1;
    }
    row += 2;
    for (const line of menu) {
      place(row, 4, line);
      row += 1;
    }
    return;
  }

  const contentW = picture.cols + GAP + PANEL_W;
  const frameW = Math.max(contentW, logoW);
  const origin = Math.max(1, Math.floor((columns - frameW) / 2) + 1);
  const stacked = columns < picture.cols + PANEL_W + 8;
  let row = 2;
  for (const line of LOGO) {
    const logoLeft = origin + Math.floor((frameW - line.length) / 2);
    place(row, Math.max(1, logoLeft), `${PURPLE}${line}`);
    row += 1;
  }
  const imageRow = row + 1;

  if (stacked) {
    const imageLeft = Math.max(1, Math.floor((columns - picture.cols) / 2) + 1);
    output.write(`\x1b[${imageRow};${imageLeft}H${picture.sixel}`);
    let menuRow = imageRow + picture.rows + 2;
    for (const line of menu) {
      place(menuRow, imageLeft, line);
      menuRow += 1;
    }
    return;
  }

  const imageLeft = origin + Math.floor((frameW - contentW) / 2);
  const panelLeft = imageLeft + picture.cols + GAP;
  output.write(`\x1b[${imageRow};${imageLeft}H${picture.sixel}`);
  for (let i = 0; i < picture.rows; i += 1) {
    place(imageRow + i, imageLeft + picture.cols + 2, `${DIM}│`);
  }
  const panelRow = imageRow + Math.max(0, Math.floor((picture.rows - menu.length) / 2));
  for (let i = 0; i < menu.length; i += 1) {
    place(panelRow + i, panelLeft, menu[i]);
  }
}

function row(index, selected, label) {
  if (index === selected) return `${PURPLE}>${RESET}  ${HOT}${label}${RESET}`;
  return `${DIM}   ${label}${RESET}`;
}

function openScreen(title, subtitle) {
  output.write(`\x1b[2J\x1b[3J\x1b[H${RESET}`);
  output.write(`\n  ${PURPLE}${title}${RESET}\n`);
  output.write(`  ${DIM}${subtitle}${RESET}\n`);
  output.write(`  ${DIM}${"─".repeat(32)}${RESET}\n\n`);
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

function drainInput() {
  if (!input.isTTY) return;
  input.setRawMode(false);
  input.resume();
  while (input.read() !== null) {}
  input.pause();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enableDirectKeys(on) {
  output.write(on ? "\x1b[?9001h" : "\x1b[?9001l");
}

function readInputChunk() {
  return new Promise((resolve) => {
    let buf = "";
    let timer = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      resolve(buf);
    };
    const ready = () => {
      if (!buf.startsWith("\u001b")) return true;
      if (buf.includes("_")) return true;
      return /\u001b\[[0-9;]*[A-Za-z~]$/.test(buf);
    };
    const onData = (chunk) => {
      buf += chunk;
      if (timer) clearTimeout(timer);
      if (ready()) finish();
      else timer = setTimeout(finish, 40);
    };
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

function decodeKeys(buf) {
  const keys = [];
  let i = 0;
  while (i < buf.length) {
    if (buf.startsWith("\u001b[", i)) {
      const end = buf.indexOf("_", i);
      if (end > i && /^\u001b\[\d/.test(buf.slice(i, end))) {
        const parts = buf.slice(i + 2, end).split(";");
        if (parts.length >= 4) {
          keys.push({
            vk: Number(parts[0]),
            unicode: Number(parts[2]),
            down: parts[3] === "1",
            control: Number(parts[4] || 0),
          });
          i = end + 1;
          continue;
        }
      }
      const match = buf.slice(i).match(/^\u001b\[([0-9;]*)([A-Za-z~])/);
      if (match) {
        keys.push({ plain: `\u001b[${match[1]}${match[2]}` });
        i += match[0].length;
        continue;
      }
    }
    keys.push({ plain: buf[i] });
    i += 1;
  }
  return keys;
}

function actionFromKey(key, { allowSkip, allowBack }) {
  if (key.vk) {
    if (!key.down) return null;
    const ctrl = key.control & 0x000c;
    if (ctrl && key.vk === 67) return "quit";
    if (key.vk === 27) return "home";
    if (ctrl && key.vk === 81) return allowBack ? "back" : null;
    if (key.vk === 16 || key.vk === 160 || key.vk === 161) return allowSkip ? "skip" : null;
    if (key.vk === 13) return "next";
    if (key.vk === 8) return "backspace";
    if (key.unicode >= 32) return { type: "text", char: String.fromCharCode(key.unicode) };
    return null;
  }
  const plain = key.plain;
  if (!plain) return null;
  if (plain === "\u0003") return "quit";
  if (plain === "\u001b") return "home";
  if (plain === "\u0011") return allowBack ? "back" : null;
  if (plain === "\r" || plain === "\n") return "next";
  if (plain === "\b" || plain === "\u007f") return "backspace";
  if (allowSkip && (plain === "\u0010" || plain === "\u001b[16;2u")) return "skip";
  if (plain.length === 1 && plain >= " ") return { type: "text", char: plain };
  return null;
}

async function readActions(options) {
  const buf = await readInputChunk();
  if (!buf.includes("\u001b") && buf.length > 1) {
    return [...buf.replace(/[\u0000-\u001f]/g, "")].map((char) => ({ type: "text", char }));
  }
  return decodeKeys(buf).map((key) => actionFromKey(key, options)).filter(Boolean);
}

function placeInputCursor(typedLength) {
  output.write(`\x1b[7;${6 + typedLength}H\x1b[?25h`);
}

async function askStep({ title, subtitle, label, value, secret, step, total, allowSkip, allowBack, fixed }) {
  let text = fixed ? "0" : value ?? "";
  enableDirectKeys(true);
  try {
    while (true) {
      openScreen(title, `${subtitle}    step ${step} of ${total}`);
      const typed = secret ? "*".repeat(Math.min(text.length, 48)) : text;
      output.write(`  ${DIM}${label}${RESET}\n`);
      output.write(`  ${PURPLE}>${RESET}  ${typed ? `${HOT}${typed}` : `${DIM}type here`}${RESET}\n\n`);
      output.write(`  ${DIM}Esc home${allowBack ? "    Ctrl+Q back" : ""}${RESET}\n`);
      if (allowSkip) output.write(`  ${DIM}Press Shift to skip this step.${RESET}\n`);
      if (fixed) output.write(`  ${DIM}ETH to buy stays 0.${RESET}\n`);
      placeInputCursor(typed.length);
      const actions = await readActions({ allowSkip, allowBack });
      for (const action of actions) {
        if (action === "quit") return { action: "quit", value: text };
        if (action === "back" && allowBack) return { action: "back", value: text };
        if (action === "home") return { action: "home", value: text };
        if (action === "skip") return { action: "skip", value: fixed ? "0" : "" };
        if (action === "next") return { action: "next", value: (fixed ? "0" : text).trim() };
        if (action === "backspace" && !fixed) text = text.slice(0, -1);
        else if (action?.type === "text" && !fixed) text += action.char;
      }
    }
  } finally {
    enableDirectKeys(false);
    output.write("\x1b[?25l");
  }
}

async function waitKeys(allowBack) {
  output.write(`\n  ${DIM}Esc home${allowBack ? "    Ctrl+Q back" : ""}${RESET}\n`);
  enableDirectKeys(true);
  try {
    while (true) {
      const actions = await readActions({ allowSkip: false, allowBack });
      for (const action of actions) {
        if (action === "quit") return "quit";
        if (action === "back" && allowBack) return "back";
        if (action === "home") return "home";
      }
    }
  } finally {
    enableDirectKeys(false);
  }
}

async function checkLine(command, work) {
  output.write(`  ${DIM}$ ${command}${RESET}\n`);
  await sleep(220);
  try {
    const detail = await work();
    output.write(`  ${PURPLE}ok${RESET}    ${DIM}${detail}${RESET}\n\n`);
    return { ok: true, detail };
  } catch (error) {
    output.write(`  fail  ${error.message}\n\n`);
    return { ok: false, detail: error.message };
  }
}

async function connect() {
  let draft = "";
  while (true) {
    const step = await askStep({
      title: "Connect wallet",
      subtitle: "The key stays in this session.",
      label: "Private key",
      value: draft,
      secret: true,
      step: 1,
      total: 1,
      allowBack: false,
    });
    draft = step.value;
    if (step.action === "quit") return "__quit__";
    if (step.action === "home") return "Connect cancelled.";
    if (!draft) continue;
    openScreen("Connect wallet", "Checking connection");
    output.write("\n");
    const keyCheck = await checkLine("clank key verify", async () => {
      accountFromKey(draft);
      return "private key accepted";
    });
    if (!keyCheck.ok) {
      const next = await waitKeys(false);
      if (next === "quit") return "__quit__";
      return "Connect cancelled.";
    }
    const opened = accountFromKey(draft);
    const chainCheck = await checkLine("clank chain ping --id 4663", async () => {
      const id = await publicClient().getChainId();
      if (id !== 4663) throw new Error(`unexpected chain ${id}`);
      return "Robinhood Chain";
    });
    const balanceCheck = await checkLine("clank balance", async () => {
      const wei = await publicClient().getBalance({ address: opened.account.address });
      return eth(wei);
    });
    if (!chainCheck.ok || !balanceCheck.ok) {
      output.write(`  ${DIM}Connection failed.${RESET}\n`);
      const next = await waitKeys(false);
      if (next === "quit") return "__quit__";
      return "Connect cancelled.";
    }
    wallet = opened;
    balanceText = balanceCheck.detail;
    output.write(`  ${HOT}Connection successful.${RESET}\n`);
    const next = await waitKeys(false);
    if (next === "quit") return "__quit__";
    return `Connected ${short(opened.account.address)}`;
  }
}

async function launchForm() {
  if (!wallet) return "Connect a wallet first.";
  const steps = [
    { id: "name", label: "Coin name", required: true },
    { id: "symbol", label: "Ticker", required: true },
    { id: "image", label: "Image path", required: true },
    { id: "twitter", label: "Twitter", required: false, skip: true },
    { id: "website", label: "Website", required: false, skip: true },
    { id: "buy", label: "ETH to buy", fixed: true, skip: true },
    { id: "confirm", label: "Type YES to send", required: true },
  ];
  const draft = { name: "", symbol: "", image: "", twitter: "", website: "", buy: "0", confirm: "" };
  let index = 0;
  while (index < steps.length) {
    const current = steps[index];
    const step = await askStep({
      title: "Launch token",
      subtitle: short(wallet.account.address),
      label: current.label,
      value: current.fixed ? "0" : draft[current.id],
      step: index + 1,
      total: steps.length,
      allowSkip: current.id !== "confirm",
      allowBack: true,
      fixed: Boolean(current.fixed),
    });
    if (step.action === "quit") return "__quit__";
    if (step.action === "home") return "Returned home.";
    if (step.action === "back") {
      if (index === 0) return "Launch cancelled.";
      index -= 1;
      continue;
    }
    if (step.action === "skip") {
      draft[current.id] = current.fixed ? "0" : "";
      index += 1;
      continue;
    }
    const value = current.fixed ? "0" : current.id === "symbol" ? step.value.toUpperCase() : step.value;
    if (current.required && !value) continue;
    if (current.id === "confirm" && value.toUpperCase() !== "YES") continue;
    draft[current.id] = value;
    index += 1;
  }
  openScreen("Launch token", "Sending");
  output.write("\n");
  try {
    const result = await launchCoin({
      name: draft.name,
      symbol: draft.symbol,
      image: draft.image,
      twitter: draft.twitter,
      website: draft.website,
      privateKey: wallet.privateKey,
      yes: true,
      onStatus: (text) => output.write(`  ${DIM}$ ${text}${RESET}\n`),
    });
    output.write("\n");
    output.write(`  ${HOT}${result.name} ($${result.symbol})${RESET}\n`);
    output.write(`  Token  ${result.token}\n`);
    output.write(`  Page   ${result.coinUrl}\n`);
    if (result.txUrl) output.write(`  Tx     ${result.txUrl}\n`);
    if (result.reason) output.write(`  ${result.reason}\n`);
    if (result.sent) output.write(`  ${HOT}Launch successful.${RESET}\n`);
    const next = await waitKeys(true);
    if (next === "quit") return "__quit__";
    if (next === "back") return "Returned to launch.";
    return result.sent ? "Launch is onchain." : result.reason || "Transaction was not sent.";
  } catch (error) {
    const message = error?.shortMessage || error?.message || String(error);
    output.write(`\n  ${message}\n`);
    const next = await waitKeys(true);
    if (next === "quit") return "__quit__";
    if (next === "back") return "Returned to launch.";
    return message;
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
    const count = wallet ? 3 : 2;
    if (selected >= count) selected = count - 1;
    paint(selected, note);
    const key = await readKey();
    if (key === "\u0003" || key === "q" || key === "Q") return;
    let activate = false;
    if (key === "\u001b[A" || key === "k") selected = Math.max(0, selected - 1);
    else if (key === "\u001b[B" || key === "j") selected = Math.min(count - 1, selected + 1);
    else if (key === "1") {
      selected = 0;
      activate = true;
    } else if (key === "2") {
      selected = 1;
      activate = true;
    } else if (key === "3" && wallet) {
      selected = 2;
      activate = true;
    } else if (key === "\r" || key === "\n") activate = true;
    if (!activate) continue;
    if (selected === 0) {
      note = await connect();
      if (note === "__quit__") return;
      await refreshBalance();
    } else if (selected === 1) {
      note = await launchForm();
      if (note === "__quit__") return;
      await refreshBalance();
    } else {
      wallet = null;
      balanceText = "";
      note = "Logged out.";
      selected = 0;
    }
  }
}

function askTerminal(sequence) {
  return new Promise((resolve) => {
    let buf = "";
    const timer = setTimeout(finish, 200);
    function finish() {
      clearTimeout(timer);
      input.off("data", onData);
      if (input.isTTY) input.setRawMode(false);
      resolve(buf);
    }
    function onData(chunk) {
      buf += chunk;
      if (buf.length > 80 || /[a-zA-Z]/.test(chunk)) finish();
    }
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
    output.write(sequence);
  });
}

async function loadPicture() {
  const cellReply = await askTerminal("\x1b[16t");
  const cell = cellReply.match(/\x1b\[6;(\d+);(\d+)t/);
  const cellH = Math.max(1, cell ? Number(cell[1]) : 20);
  const cellW = Math.max(1, cell ? Number(cell[2]) : 10);
  const edge = Math.min(260, 22 * cellW, 16 * cellH);
  const image = portraitImage(edge, edge);
  picture = {
    sixel: image.sixel,
    cols: Math.max(1, Math.ceil(image.width / cellW)),
    rows: Math.max(1, Math.ceil(image.height / cellH)),
  };
}

export async function openUi() {
  if (!input.isTTY || !output.isTTY) {
    output.write("Open a terminal and run clank-trade to open the screen.\n");
    return;
  }
  output.write("\x1b[?1049h");
  try {
    await loadPicture();
    await home();
  } finally {
    if (input.isTTY) {
      input.setRawMode(false);
      input.pause();
    }
    output.write(`\x1b[0m\x1b[?25h\x1b[?1049l`);
  }
}
