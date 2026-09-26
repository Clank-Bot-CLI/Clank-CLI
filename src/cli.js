#!/usr/bin/env node
import { parseArgs } from "node:util";
import { formatEther } from "viem";
import { eth } from "./chain.js";
import { accountFromEnv, launchCoin, readPlatform } from "./launch.js";

const help = `clank-trade — launch coin trên clank.trade (Robinhood Chain, chain 4663)

Cách dùng:
  clank-trade status
  clank-trade address
  clank-trade launch --name "Tên coin" --symbol TICKER --image .\\logo.png
  clank-trade launch --name "Tên coin" --symbol TICKER --logo ipfs://... --yes

Tùy chọn launch:
  --name          Tên coin, tối đa 64 byte
  --symbol        Ticker, tối đa 16 byte
  --image         Ảnh PNG, JPEG hoặc WebP, tối đa 2 MB
  --logo          URL ảnh sẵn (ipfs:// hoặc https://), dùng thay --image
  --twitter       Link X, không bắt buộc
  --website       Link website, không bắt buộc
  --description   Mô tả, không bắt buộc
  --buy           ETH mua ngay khi launch, ví dụ 0.01
  --min-tokens    Số token tối thiểu nhận về khi có --buy. Mặc định 0
  --salt          bytes32 cố định, không bắt buộc
  --yes           Gửi giao dịch. Không có cờ này thì chỉ mô phỏng

Biến môi trường:
  CLANK_PRIVATE_KEY   Private key ví trả gas, dạng 0x + 64 hex
  CLANK_RPC_URL       RPC Robinhood Chain. Mặc định rpc.mainnet.chain.robinhood.com

Khóa ví chỉ đọc từ môi trường và không được in ra.
`;

function fail(error) {
  const message = error?.shortMessage || error?.message || String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function status() {
  const platform = await readPlatform();
  const lines = [
    `Mạng: Robinhood Chain (${platform.chainId})`,
    `Factory: ${platform.factory}`,
    `Launch config: ${platform.launchConfigId}`,
    `Launch đang bật: ${platform.enabled ? "có" : "không"}`,
    `Config đang bật: ${platform.launchConfig.enabled ? "có" : "không"}`,
    `Phí launch khi mua kèm: ${eth(platform.fee)}`,
    `Phí curve: ${platform.launchConfig.curveFeeBps} bps`,
    `Supply: ${formatEther(platform.launchConfig.supply)}`,
    `Ngưỡng graduation: ${formatEther(platform.launchConfig.graduationThreshold)} ETH`,
    `Quote: ${platform.config.quoteToken}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function address() {
  const account = accountFromEnv();
  process.stdout.write(`${account.address}\n`);
}

function flag(values, name) {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

async function launch(values) {
  const result = await launchCoin({
    name: flag(values, "name"),
    symbol: flag(values, "symbol"),
    image: flag(values, "image"),
    logo: flag(values, "logo"),
    twitter: flag(values, "twitter"),
    website: flag(values, "website"),
    description: flag(values, "description"),
    buy: flag(values, "buy"),
    minTokens: flag(values, "min-tokens"),
    salt: flag(values, "salt"),
    yes: values.yes === true,
  });
  const lines = [
    `Ví: ${result.wallet}`,
    `Coin: ${result.name} ($${result.symbol})`,
    `Logo: ${result.logo}`,
    `Token dự kiến: ${result.token}`,
    `Curve dự kiến: ${result.curve}`,
    `Trang: ${result.coinUrl}`,
    `Mua kèm: ${result.buy}`,
    `Value giao dịch: ${result.value}`,
    `Số dư: ${result.balance}`,
  ];
  if (result.gas) lines.push(`Gas limit: ${result.gas}`);
  if (result.hash) lines.push(`Tx: ${result.txUrl}`);
  if (result.reason) lines.push(result.reason);
  if (result.sent) lines.push("Launch đã lên chain.");
  process.stdout.write(`${lines.join("\n")}\n`);
  if (!result.sent && result.simulated === false) process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(help);
    return;
  }
  if (command === "status") {
    await status();
    return;
  }
  if (command === "address") {
    await address();
    return;
  }
  if (command === "launch") {
    const { values } = parseArgs({
      args: rest,
      options: {
        name: { type: "string" },
        symbol: { type: "string" },
        image: { type: "string" },
        logo: { type: "string" },
        twitter: { type: "string" },
        website: { type: "string" },
        description: { type: "string" },
        buy: { type: "string" },
        "min-tokens": { type: "string" },
        salt: { type: "string" },
        yes: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (!values.image && !values.logo) {
      throw new Error("Cần --image hoặc --logo.");
    }
    if (values.image && values.logo) {
      throw new Error("Chỉ dùng một trong --image hoặc --logo.");
    }
    await launch(values);
    return;
  }
  throw new Error(`Lệnh không rõ: ${command}\n\n${help}`);
}

main().catch(fail);
