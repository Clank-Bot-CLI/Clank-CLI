#!/usr/bin/env node
import { parseArgs } from "node:util";
import { formatEther } from "viem";
import { eth } from "./chain.js";
import { accountFromEnv, launchCoin, readPlatform } from "./launch.js";
import { openUi } from "./ui.js";

const help = `clank-trade — launch a coin on clank.trade (Robinhood Chain, chain 4663)

Usage:
  clank-trade
  clank-trade status
  clank-trade address
  clank-trade launch --name "Coin name" --symbol TICKER --image .\\logo.png
  clank-trade launch --name "Coin name" --symbol TICKER --logo ipfs://... --yes

Launch options:
  --name          Coin name, 64 bytes max
  --symbol        Ticker, 16 bytes max
  --image         PNG, JPEG, or WebP, 2 MB max
  --logo          Existing image URL (ipfs:// or https://), instead of --image
  --twitter       X link, optional
  --website       Website link, optional
  --description   Description, optional
  --buy           ETH to buy at launch, for example 0.01
  --min-tokens    Minimum tokens out when using --buy. Default 0
  --salt          Fixed bytes32, optional
  --yes           Send the transaction. Without this flag the command only simulates

Environment:
  CLANK_PRIVATE_KEY   Wallet private key that pays gas, 0x plus 64 hex characters
  CLANK_RPC_URL       Robinhood Chain RPC. Default rpc.mainnet.chain.robinhood.com

The wallet key is read from the environment and is never printed.
`;

function fail(error) {
  const message = error?.shortMessage || error?.message || String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function status() {
  const platform = await readPlatform();
  const lines = [
    `Network: Robinhood Chain (${platform.chainId})`,
    `Factory: ${platform.factory}`,
    `Launch config: ${platform.launchConfigId}`,
    `Launch enabled: ${platform.enabled ? "yes" : "no"}`,
    `Config enabled: ${platform.launchConfig.enabled ? "yes" : "no"}`,
    `Launch fee when buying: ${eth(platform.fee)}`,
    `Curve fee: ${platform.launchConfig.curveFeeBps} bps`,
    `Supply: ${formatEther(platform.launchConfig.supply)}`,
    `Graduation threshold: ${formatEther(platform.launchConfig.graduationThreshold)} ETH`,
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
    `Wallet: ${result.wallet}`,
    `Coin: ${result.name} ($${result.symbol})`,
    `Logo: ${result.logo}`,
    `Predicted token: ${result.token}`,
    `Predicted curve: ${result.curve}`,
    `Page: ${result.coinUrl}`,
    `Initial buy: ${result.buy}`,
    `Transaction value: ${result.value}`,
    `Balance: ${result.balance}`,
  ];
  if (result.gas) lines.push(`Gas limit: ${result.gas}`);
  if (result.hash) lines.push(`Tx: ${result.txUrl}`);
  if (result.reason) lines.push(result.reason);
  if (result.sent) lines.push("Launch is onchain.");
  process.stdout.write(`${lines.join("\n")}\n`);
  if (!result.sent && result.simulated === false) process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    await openUi();
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
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
      throw new Error("Provide --image or --logo.");
    }
    if (values.image && values.logo) {
      throw new Error("Use only one of --image or --logo.");
    }
    await launch(values);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch(fail);
